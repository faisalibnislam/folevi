package api

import "crypto/x509"

func newPool(der []byte) *x509.CertPool {
	c, err := x509.ParseCertificate(der)
	if err != nil {
		panic(err)
	}
	p := x509.NewCertPool()
	p.AddCert(c)
	return p
}
