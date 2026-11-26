// Package supervisor runs a child program, restarts it with backoff when it exits, and stops it cleanly.
package supervisor

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

// States reported by Status.
const (
	StateStopped  = "stopped"
	StateStarting = "starting"
	StateRunning  = "running"
	StateBackoff  = "backoff"
)

// Command is what to run. It is built again for every start, so a changed public address or setting reaches
// the next start.
type Command struct {
	Path string
	Args []string
	Env  []string
	Dir  string
}

// Spec describes a service.
type Spec struct {
	Name string
	// Build returns the command for the next start.
	Build func() (Command, error)
	// Output receives stdout and stderr.
	Output io.Writer
	// StopTimeout is how long to wait after SIGTERM before SIGKILL (default 15 s).
	StopTimeout time.Duration
	// MinBackoff and MaxBackoff bound the wait between crash restarts (default 1 s and 60 s).
	MinBackoff, MaxBackoff time.Duration
	// StableAfter is how long a run must last for the backoff to reset (default 60 s).
	StableAfter time.Duration
	Log         *slog.Logger
}

// Status is a snapshot for the control API.
type Status struct {
	Name     string `json:"name"`
	State    string `json:"state"`
	PID      int    `json:"pid"`
	Restarts int    `json:"restarts"`
}

// Service is one supervised program.
type Service struct {
	spec Spec

	mu       sync.Mutex
	state    string
	pid      int
	restarts int
	running  bool
	stopCh   chan struct{}
	restart  chan struct{}
	done     chan struct{}
}

// New makes a stopped service.
func New(spec Spec) *Service {
	if spec.StopTimeout == 0 {
		spec.StopTimeout = 15 * time.Second
	}
	if spec.MinBackoff == 0 {
		spec.MinBackoff = time.Second
	}
	if spec.MaxBackoff == 0 {
		spec.MaxBackoff = 60 * time.Second
	}
	if spec.StableAfter == 0 {
		spec.StableAfter = 60 * time.Second
	}
	if spec.Log == nil {
		spec.Log = slog.Default()
	}
	if spec.Output == nil {
		spec.Output = io.Discard
	}
	return &Service{spec: spec, state: StateStopped}
}

// Name is the service name.
func (s *Service) Name() string { return s.spec.Name }

// Status returns the current state.
func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Status{Name: s.spec.Name, State: s.state, PID: s.pid, Restarts: s.restarts}
}

// Start begins supervising. It returns at once; calling it on a running service does nothing.
func (s *Service) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return
	}
	s.running = true
	s.stopCh = make(chan struct{})
	s.restart = make(chan struct{}, 1)
	s.done = make(chan struct{})
	s.state = StateStarting
	go s.loop(s.stopCh, s.restart, s.done)
}

// Restart stops the current process and starts a new one at once (not counted as a crash).
func (s *Service) Restart() {
	s.mu.Lock()
	ch := s.restart
	running := s.running
	s.mu.Unlock()
	if !running {
		s.Start()
		return
	}
	select {
	case ch <- struct{}{}:
	default:
	}
}

// Stop stops the process (SIGTERM, then SIGKILL after StopTimeout) and waits for it.
func (s *Service) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	close(s.stopCh)
	done := s.done
	s.mu.Unlock()
	<-done
}

func (s *Service) setState(state string, pid int) {
	s.mu.Lock()
	s.state, s.pid = state, pid
	s.mu.Unlock()
}

func (s *Service) loop(stop, restart, done chan struct{}) {
	defer close(done)
	defer s.setState(StateStopped, 0)
	backoff := s.spec.MinBackoff
	log := s.spec.Log.With("service", s.spec.Name)
	for {
		select {
		case <-stop:
			return
		default:
		}
		s.setState(StateStarting, 0)
		cmd, waitCh, err := s.startOnce()
		if err != nil {
			log.Error("could not start", "err", err)
			if !s.sleep(backoff, stop) {
				return
			}
			backoff = min(backoff*2, s.spec.MaxBackoff)
			continue
		}
		started := time.Now()
		s.setState(StateRunning, cmd.Process.Pid)
		log.Info("started", "pid", cmd.Process.Pid)
		select {
		case <-stop:
			s.terminate(cmd, waitCh)
			log.Info("stopped")
			return
		case <-restart:
			s.terminate(cmd, waitCh)
			log.Info("restarted on request")
			backoff = s.spec.MinBackoff
			continue
		case err := <-waitCh:
			s.mu.Lock()
			s.restarts++
			s.mu.Unlock()
			if time.Since(started) >= s.spec.StableAfter {
				backoff = s.spec.MinBackoff
			}
			log.Warn("exited, restarting", "err", errString(err), "after", backoff.String())
			s.setState(StateBackoff, 0)
			if !s.sleep(backoff, stop) {
				return
			}
			backoff = min(backoff*2, s.spec.MaxBackoff)
		}
	}
}

func errString(err error) string {
	if err == nil {
		return "exit status 0"
	}
	return err.Error()
}

func (s *Service) sleep(d time.Duration, stop chan struct{}) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-stop:
		return false
	}
}

func (s *Service) startOnce() (*exec.Cmd, chan error, error) {
	c, err := s.spec.Build()
	if err != nil {
		return nil, nil, err
	}
	cmd := exec.Command(c.Path, c.Args...)
	cmd.Env = c.Env
	cmd.Dir = c.Dir
	cmd.Stdout = s.spec.Output
	cmd.Stderr = s.spec.Output
	cmd.SysProcAttr = sysProcAttr()
	if err := cmd.Start(); err != nil {
		return nil, nil, err
	}
	waitCh := make(chan error, 1)
	go func() {
		err := cmd.Wait()
		if f, ok := s.spec.Output.(interface{ Flush() }); ok {
			f.Flush()
		}
		waitCh <- err
	}()
	return cmd, waitCh, nil
}

// terminate sends SIGTERM to the process group, then SIGKILL after StopTimeout.
func (s *Service) terminate(cmd *exec.Cmd, waitCh chan error) {
	pid := cmd.Process.Pid
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	t := time.NewTimer(s.spec.StopTimeout)
	defer t.Stop()
	select {
	case <-waitCh:
	case <-t.C:
		s.spec.Log.Warn("did not stop in time, killing", "service", s.spec.Name)
		_ = syscall.Kill(-pid, syscall.SIGKILL)
		<-waitCh
	}
	// Anything left in the group (for example the backend's node helper) goes too.
	_ = syscall.Kill(-pid, syscall.SIGKILL)
}

// RunOnce runs a command to completion (used for keygen, deploy and export). Output goes to out.
func RunOnce(ctx context.Context, c Command, out io.Writer) error {
	cmd := exec.CommandContext(ctx, c.Path, c.Args...)
	cmd.Env = c.Env
	cmd.Dir = c.Dir
	cmd.Stdout = out
	cmd.Stderr = out
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 5 * time.Second
	err := cmd.Run()
	if f, ok := out.(interface{ Flush() }); ok {
		f.Flush()
	}
	if ctx.Err() != nil && err != nil {
		return errors.Join(ctx.Err(), err)
	}
	return err
}

// Environ returns os.Environ without the variables in drop, plus extra.
func Environ(drop []string, extra ...string) []string {
	skip := map[string]bool{}
	for _, d := range drop {
		skip[d] = true
	}
	for _, e := range extra {
		for i := 0; i < len(e); i++ {
			if e[i] == '=' {
				skip[e[:i]] = true
				break
			}
		}
	}
	var out []string
	for _, e := range os.Environ() {
		for i := 0; i < len(e); i++ {
			if e[i] == '=' {
				if !skip[e[:i]] {
					out = append(out, e)
				}
				break
			}
		}
	}
	return append(out, extra...)
}
