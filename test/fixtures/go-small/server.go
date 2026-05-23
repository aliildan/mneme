package server

import (
	"fmt"
	"net/http"
)

type Config struct {
	Host string
	Port int
}

type Handler interface {
	ServeHTTP(w http.ResponseWriter, r *http.Request)
}

func NewConfig(host string, port int) *Config {
	return &Config{Host: host, Port: port}
}

func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}
