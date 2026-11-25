// Package netx announces the server on the home network (mDNS) and asks the router to open a port
// (UPnP IGD, then NAT-PMP).
package netx

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"time"

	"github.com/hashicorp/mdns"
	"github.com/huin/goupnp/dcps/internetgateway2"
	"github.com/jackpal/gateway"
	natpmp "github.com/jackpal/go-nat-pmp"
)

// ServiceType is the mDNS service apps browse for.
const ServiceType = "_folevi._tcp"

// Announcer is a running mDNS responder.
type Announcer struct{ srv *mdns.Server }

// Announce starts answering mDNS queries for _folevi._tcp on port with these TXT records
// (for example "version=1.7.0", "id=<serverId>", "path=/").
func Announce(instance string, port int, ips []net.IP, txt []string) (*Announcer, error) {
	if instance == "" {
		instance = "Folevi"
	}
	svc, err := mdns.NewMDNSService(instance, ServiceType, "", "", port, ips, txt)
	if err != nil {
		return nil, err
	}
	srv, err := mdns.NewServer(&mdns.Config{Zone: svc, Logger: log.New(io.Discard, "", 0)})
	if err != nil {
		return nil, err
	}
	return &Announcer{srv: srv}, nil
}

// Stop stops answering.
func (a *Announcer) Stop() {
	if a != nil && a.srv != nil {
		_ = a.srv.Shutdown()
	}
}

// Mapping is a router port mapping.
type Mapping struct {
	Method       string // "upnp" or "natpmp"
	ExternalPort int
	InternalPort int
	ExternalIP   string
	unmap        func() error
}

// Remove deletes the mapping from the router.
func (m *Mapping) Remove() error {
	if m == nil || m.unmap == nil {
		return nil
	}
	return m.unmap()
}

type igdClient interface {
	AddPortMappingCtx(ctx context.Context, NewRemoteHost string, NewExternalPort uint16, NewProtocol string,
		NewInternalPort uint16, NewInternalClient string, NewEnabled bool, NewPortMappingDescription string,
		NewLeaseDuration uint32) error
	DeletePortMappingCtx(ctx context.Context, NewRemoteHost string, NewExternalPort uint16, NewProtocol string) error
	GetExternalIPAddressCtx(ctx context.Context) (string, error)
}

// MapPort asks the router to forward TCP externalPort to localIP:internalPort for lease. It tries UPnP first,
// then NAT-PMP. Call it again before the lease ends to renew.
func MapPort(ctx context.Context, localIP string, internalPort, externalPort int, desc string, lease time.Duration) (*Mapping, error) {
	m, upnpErr := mapUPnP(ctx, localIP, internalPort, externalPort, desc, lease)
	if upnpErr == nil {
		return m, nil
	}
	m, pmpErr := mapNATPMP(internalPort, externalPort, lease)
	if pmpErr == nil {
		return m, nil
	}
	return nil, fmt.Errorf("upnp: %v; nat-pmp: %v", upnpErr, pmpErr)
}

func mapUPnP(ctx context.Context, localIP string, internalPort, externalPort int, desc string, lease time.Duration) (*Mapping, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var clients []igdClient
	if cs, _, err := internetgateway2.NewWANIPConnection2ClientsCtx(ctx); err == nil {
		for _, c := range cs {
			clients = append(clients, c)
		}
	}
	if cs, _, err := internetgateway2.NewWANIPConnection1ClientsCtx(ctx); err == nil {
		for _, c := range cs {
			clients = append(clients, c)
		}
	}
	if cs, _, err := internetgateway2.NewWANPPPConnection1ClientsCtx(ctx); err == nil {
		for _, c := range cs {
			clients = append(clients, c)
		}
	}
	if len(clients) == 0 {
		return nil, errors.New("no UPnP router found")
	}
	var lastErr error
	for _, c := range clients {
		err := c.AddPortMappingCtx(ctx, "", uint16(externalPort), "TCP", uint16(internalPort), localIP, true, desc,
			uint32(lease/time.Second))
		if err != nil {
			lastErr = err
			continue
		}
		ip, _ := c.GetExternalIPAddressCtx(ctx)
		cl := c
		return &Mapping{Method: "upnp", ExternalPort: externalPort, InternalPort: internalPort, ExternalIP: ip,
			unmap: func() error {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				return cl.DeletePortMappingCtx(ctx, "", uint16(externalPort), "TCP")
			}}, nil
	}
	return nil, lastErr
}

func mapNATPMP(internalPort, externalPort int, lease time.Duration) (*Mapping, error) {
	gw, err := gateway.DiscoverGateway()
	if err != nil {
		return nil, err
	}
	c := natpmp.NewClientWithTimeout(gw, 3*time.Second)
	res, err := c.AddPortMapping("tcp", internalPort, externalPort, int(lease/time.Second))
	if err != nil {
		return nil, err
	}
	m := &Mapping{Method: "natpmp", ExternalPort: int(res.MappedExternalPort), InternalPort: internalPort,
		unmap: func() error {
			_, err := c.AddPortMapping("tcp", internalPort, 0, 0)
			return err
		}}
	if ext, err := c.GetExternalAddress(); err == nil {
		a := ext.ExternalIPAddress
		m.ExternalIP = net.IPv4(a[0], a[1], a[2], a[3]).String()
	}
	return m, nil
}
