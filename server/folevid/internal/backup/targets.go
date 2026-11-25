package backup

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/faisalibnislam/folevi/server/folevid/internal/config"
)

// FolderTarget keeps backups in a folder (the data folder's backups/ for "local", any other for "folder").
type FolderTarget struct {
	Dir     string
	IsLocal bool
}

func (t *FolderTarget) Local() bool { return t.IsLocal }

func (t *FolderTarget) Put(ctx context.Context, localPath, name string) error {
	if err := os.MkdirAll(t.Dir, 0o700); err != nil {
		return err
	}
	dst := filepath.Join(t.Dir, filepath.Base(name))
	return copyFile(localPath, dst)
}

func (t *FolderTarget) Get(ctx context.Context, name, localPath string) error {
	return copyFile(filepath.Join(t.Dir, filepath.Base(name)), localPath)
}

func (t *FolderTarget) List(ctx context.Context) ([]Object, error) {
	ents, err := os.ReadDir(t.Dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []Object
	for _, e := range ents {
		if !e.Type().IsRegular() || !strings.HasSuffix(e.Name(), ".zip") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, Object{Name: e.Name(), Size: info.Size(), Modified: info.ModTime()})
	}
	return out, nil
}

func (t *FolderTarget) Delete(ctx context.Context, name string) error {
	err := os.Remove(filepath.Join(t.Dir, filepath.Base(name)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".partial"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

// S3Target keeps backups in an S3-compatible bucket (Backblaze B2, Wasabi, MinIO, the NAS's own S3).
type S3Target struct {
	client *minio.Client
	bucket string
	prefix string
}

// NewS3 connects to the bucket described in the config.
func NewS3(c *config.S3Target) (*S3Target, error) {
	if c == nil {
		return nil, errors.New("no s3 settings")
	}
	endpoint, secure := c.Endpoint, true
	if strings.Contains(endpoint, "://") {
		u, err := url.Parse(endpoint)
		if err != nil {
			return nil, fmt.Errorf("s3 endpoint: %w", err)
		}
		endpoint, secure = u.Host, u.Scheme == "https"
	}
	cl, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(c.AccessKeyID, c.SecretAccessKey, ""),
		Secure: secure,
		Region: c.Region,
	})
	if err != nil {
		return nil, err
	}
	prefix := strings.Trim(c.Prefix, "/")
	if prefix != "" {
		prefix += "/"
	}
	return &S3Target{client: cl, bucket: c.Bucket, prefix: prefix}, nil
}

func (t *S3Target) Local() bool { return false }

func (t *S3Target) key(name string) string { return t.prefix + path.Base(name) }

func (t *S3Target) Put(ctx context.Context, localPath, name string) error {
	_, err := t.client.FPutObject(ctx, t.bucket, t.key(name), localPath, minio.PutObjectOptions{ContentType: "application/zip"})
	return err
}

func (t *S3Target) Get(ctx context.Context, name, localPath string) error {
	return t.client.FGetObject(ctx, t.bucket, t.key(name), localPath, minio.GetObjectOptions{})
}

func (t *S3Target) List(ctx context.Context) ([]Object, error) {
	var out []Object
	for o := range t.client.ListObjects(ctx, t.bucket, minio.ListObjectsOptions{Prefix: t.prefix}) {
		if o.Err != nil {
			return nil, o.Err
		}
		name := strings.TrimPrefix(o.Key, t.prefix)
		if strings.Contains(name, "/") {
			continue
		}
		out = append(out, Object{Name: name, Size: o.Size, Modified: o.LastModified})
	}
	return out, nil
}

func (t *S3Target) Delete(ctx context.Context, name string) error {
	return t.client.RemoveObject(ctx, t.bucket, t.key(name), minio.RemoveObjectOptions{})
}

// TargetFor builds the target from the config. localDir is <data>/backups.
func TargetFor(b config.BackupTarget, localDir string) (Target, error) {
	switch b.Kind {
	case "", "local":
		return &FolderTarget{Dir: localDir, IsLocal: true}, nil
	case "folder":
		if !filepath.IsAbs(b.Path) {
			return nil, errors.New("backup folder must be an absolute path")
		}
		return &FolderTarget{Dir: b.Path}, nil
	case "s3":
		return NewS3(b.S3)
	}
	return nil, fmt.Errorf("unknown backup target %q", b.Kind)
}
