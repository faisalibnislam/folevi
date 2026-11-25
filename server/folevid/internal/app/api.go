package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/faisalibnislam/folevi/server/folevid/internal/backup"
	"github.com/faisalibnislam/folevi/server/folevid/internal/config"
	"github.com/faisalibnislam/folevi/server/folevid/internal/control"
	"github.com/faisalibnislam/folevi/server/folevid/internal/logs"
	"github.com/faisalibnislam/folevi/server/folevid/internal/secrets"
	"github.com/faisalibnislam/folevi/server/folevid/internal/supervisor"
	"github.com/faisalibnislam/folevi/server/folevid/internal/sysinfo"
)

var _ control.Backend = (*App)(nil)

// Status implements control.Backend.
func (a *App) Status() control.Status {
	var s control.Status
	s.Version = a.version
	s.UptimeSeconds = int64(time.Since(a.started).Seconds())
	s.PublicURL = a.Origin()
	s.Services = append(s.Services, control.Service{Name: "folevid", State: supervisor.StateRunning, PID: os.Getpid(),
		RSSBytes: sysinfo.RSS(os.Getpid())})
	for _, svc := range []*supervisor.Service{a.backend, a.web} {
		st := svc.Status()
		s.Services = append(s.Services, control.Service{Name: st.Name, State: st.State, PID: st.PID,
			RSSBytes: sysinfo.RSS(st.PID), Restarts: st.Restarts})
	}
	s.Disk.DataBytes = a.dataSize()
	s.Disk.FreeBytes = sysinfo.Free(a.data)
	s.Memory.TotalBytes, s.Memory.AvailableBytes = sysinfo.Memory()
	s.Memory.Profile = MemoryProfile(a.cfg.Get().MemoryProfile, s.Memory.TotalBytes)
	s.Memory.Low = s.Memory.Profile == "tiny" || (s.Memory.AvailableBytes > 0 && s.Memory.AvailableBytes < 256<<20)
	return s
}

// dataSize walks the data folder at most once a minute.
func (a *App) dataSize() uint64 {
	a.diskMu.Lock()
	defer a.diskMu.Unlock()
	if time.Since(a.diskAt) > time.Minute {
		a.diskBytes = sysinfo.DirSize(a.data)
		a.diskAt = time.Now()
	}
	return a.diskBytes
}

// Logs implements control.Backend.
func (a *App) Logs(service string, lines int) ([]string, error) {
	out, err := logs.Tail(filepath.Join(a.data, "logs", service+".log"), lines, a.red)
	if errors.Is(err, os.ErrNotExist) || out == nil {
		return []string{}, nil
	}
	return out, err
}

func (a *App) target() (backup.Target, error) {
	return backup.TargetFor(a.cfg.Get().Backup.Target, filepath.Join(a.data, "backups"))
}

// Backups implements control.Backend.
func (a *App) Backups() (control.Backups, error) {
	res := control.Backups{Backups: []control.Backup{}, Schedule: control.ScheduleFromConfig(a.cfg.Get().Backup)}
	t, err := a.target()
	if err != nil {
		return res, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	list, err := backup.List(ctx, t)
	if err != nil {
		return res, err
	}
	for _, b := range list {
		res.Backups = append(res.Backups, control.Backup{ID: b.ID, CreatedAt: b.CreatedAt, SizeBytes: b.SizeBytes, Kind: b.Kind,
			Encrypted: b.Encrypted})
	}
	return res, nil
}

func (a *App) createBackup(ctx context.Context, kind string) (backup.Info, error) {
	t, err := a.target()
	if err != nil {
		return backup.Info{}, err
	}
	id := backup.NewID(time.Now(), kind)
	a.log.Info("backup started", "id", id)
	start := time.Now()
	info, err := a.bk.Create(ctx, id, t, a.cfg.Get().Backup.Keep)
	if err != nil {
		a.log.Error("backup failed", "id", id, "err", a.red.Redact(err.Error()))
		return info, err
	}
	a.log.Info("backup done", "id", id, "bytes", info.SizeBytes, "seconds", int(time.Since(start).Seconds()))
	return info, nil
}

// StartBackup implements control.Backend.
func (a *App) StartBackup(kind string, wait bool) (string, error) {
	if !a.conv.Ready(context.Background()) {
		return "", control.Conflict("the backend is not running")
	}
	if !a.bk.TryLock() {
		return "", control.Conflict(backup.ErrBusy.Error())
	}
	id := backup.NewID(time.Now(), kind)
	run := func() (string, error) {
		defer a.bk.Unlock()
		info, err := a.createBackup(a.ctx, kind)
		return info.ID, err
	}
	if wait {
		return run()
	}
	go func() { _, _ = run() }()
	return id, nil
}

// SetSchedule implements control.Backend.
func (a *App) SetSchedule(s control.Schedule) error {
	if s.Target.Kind == "folder" {
		if !filepath.IsAbs(s.Target.Path) {
			return control.BadRequest("the folder must be an absolute path")
		}
		if err := os.MkdirAll(s.Target.Path, 0o700); err != nil {
			return control.BadRequest("cannot use that folder: " + err.Error())
		}
	}
	err := a.cfg.Update(func(c *config.Config) error { return control.ApplySchedule(c, s) })
	var ce *control.Error
	if err != nil && !errors.As(err, &ce) {
		return control.BadRequest(err.Error())
	}
	return err
}

// BackupKey implements control.Backend.
func (a *App) BackupKey() (control.BackupKey, error) {
	key, err := a.sec.MustGet(secrets.BackupKey)
	if err != nil {
		return control.BackupKey{}, err
	}
	rcpt, err := backup.Recipient(key)
	if err != nil {
		return control.BackupKey{}, fmt.Errorf("secrets/backup-key is damaged: %w", err)
	}
	return control.BackupKey{Key: key, Recipient: rcpt}, nil
}

// Restore implements control.Backend: stops the web server, imports the backup and starts it again. key, when
// given, is the backup key of the server that made the backup; when it (not this server's own key) opened the
// backup, it becomes this server's backup key too, so the key the owner saved keeps opening every backup.
func (a *App) Restore(id, key string) error {
	if !backup.ValidID(id) {
		return control.BadRequest("bad backup id")
	}
	key = strings.TrimSpace(key)
	if key != "" {
		if _, err := backup.ParseKey(key); err != nil {
			return control.BadRequest(err.Error())
		}
		key = strings.ToUpper(key)
		// Never let the typed key reach a log line.
		a.red.Set(append(a.sec.Values(), key))
	}
	if !a.conv.Ready(context.Background()) {
		return control.Conflict("the backend is not running")
	}
	if !a.bk.TryLock() {
		return control.Conflict(backup.ErrBusy.Error())
	}
	defer a.bk.Unlock()
	t, err := a.target()
	if err != nil {
		return err
	}
	a.log.Info("restore started", "id", id)
	a.web.Stop()
	defer a.web.Start()
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	usedKey, err := a.bk.Restore(ctx, id, t, key)
	if err != nil {
		a.log.Error("restore failed", "id", id, "err", a.red.Redact(err.Error()))
		if errors.Is(err, backup.ErrWrongKey) {
			return &control.Error{Status: http.StatusUnprocessableEntity, Message: err.Error()}
		}
		if strings.Contains(err.Error(), "not found") {
			return control.NotFound(err.Error())
		}
		return err
	}
	if usedKey {
		if cur, _ := a.sec.Get(secrets.BackupKey); cur != key {
			if err := a.sec.Set(secrets.BackupKey, key); err != nil {
				return fmt.Errorf("restored, but saving the backup key failed: %w", err)
			}
			a.log.Info("backup key replaced by the one used for this restore")
		}
	}
	if key != "" {
		a.red.Set(a.sec.Values())
	}
	// The secrets may have changed and the data replaced: set the environment and deploy again.
	if err := a.ensureDeployed(ctx, true); err != nil {
		return fmt.Errorf("restored, but the deploy failed: %w", err)
	}
	a.log.Info("restore done", "id", id)
	return nil
}

// Update implements control.Backend. folevid does not check for updates by itself (no phone-home); the
// package manager or store does.
func (a *App) Update() control.Update {
	managed := a.opts.Getenv("FOLEVI_MANAGED_BY")
	switch managed {
	case "store", "apt", "folevid":
	default:
		managed = "folevid"
	}
	return control.Update{Current: a.version, Channel: a.cfg.Get().Channel, ManagedBy: managed}
}

// scheduleLoop runs the nightly backup.
func (a *App) scheduleLoop(ctx context.Context) {
	// Start from the newest nightly backup already there, so a restart does not take a second one.
	if t, err := a.target(); err == nil {
		lctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		if list, err := backup.List(lctx, t); err == nil {
			for _, b := range list {
				if b.Kind == backup.KindNightly {
					a.lastNightly = b.CreatedAt
					break
				}
			}
		}
		cancel()
	}
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		b := a.cfg.Get().Backup
		now := time.Now()
		if !b.Enabled || !backup.DueNightly(now, b.Hour, a.lastNightly) || !a.conv.Ready(ctx) {
			continue
		}
		if !a.bk.TryLock() {
			continue
		}
		_, err := a.createBackup(ctx, backup.KindNightly)
		a.bk.Unlock()
		// Do not retry every minute after a failure: try again at the next slot.
		a.lastNightly = now
		_ = err
	}
}
