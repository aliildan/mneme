use std::collections::HashMap;
use std::fmt;

pub struct Config {
    pub host: String,
    pub port: u16,
}

pub enum Status {
    Ok,
    Error(String),
}

pub trait Handler {
    fn handle(&self, path: &str) -> Status;
}

pub fn new_config(host: &str, port: u16) -> Config {
    Config {
        host: host.to_string(),
        port,
    }
}

impl Config {
    pub fn addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}
