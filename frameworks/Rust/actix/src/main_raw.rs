#[global_allocator]
static ALLOC: jemallocator::Jemalloc = jemallocator::Jemalloc;

#[macro_use]
extern crate serde_derive;
#[macro_use]
extern crate diesel;

use std::future::Future;
use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use actix_codec::{AsyncRead, AsyncWrite, Decoder};
use actix_http::{h1, Request};
use actix_rt::net::TcpStream;
use actix_server::Server;
use actix_service::fn_service;
use bytes::{Buf, BufMut, BytesMut};
use serde_json::to_writer;

mod models;
mod utils;

use crate::utils::{Message, Writer};

const JSON: &[u8] = b"HTTP/1.1 200 OK\r\nServer: Actix\r\nContent-Type: application/json\r\nContent-Length: 27\r\n";
const PLAIN: &[u8] = b"HTTP/1.1 200 OK\r\nServer: Actix\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n";
const HTTPNFOUND: &[u8] = b"HTTP/1.1 400 OK\r\n";
const HDR_SERVER: &[u8] = b"Server: Actix\r\n";
const BODY: &[u8] = b"Hello, World!";

struct App {
    io: TcpStream,
    read_buf: BytesMut,
    write_buf: BytesMut,
    codec: h1::Codec,
}

impl App {
    fn handle_request(&mut self, req: Request) {
        let path = req.path();
        match path {
            "/json" => {
                let message = Message {
                    message: "Hello, World!",
                };
                self.write_buf.put_slice(JSON);
                self.codec.config().set_date(&mut self.write_buf);
                to_writer(Writer(&mut self.write_buf), &message).unwrap();
            }
            "/plaintext" => {
                self.write_buf.put_slice(PLAIN);
                self.codec.config().set_date(&mut self.write_buf);
                self.write_buf.put_slice(BODY);
            }
            _ => {
                self.write_buf.put_slice(HTTPNFOUND);
                self.write_buf.put_slice(HDR_SERVER);
            }
        }
    }
}

impl Future for App {
    type Output = Result<(), ()>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.get_mut();

        loop {
            if this.read_buf.capacity() - this.read_buf.len() < 4096 {
                this.read_buf.reserve(32_768);
            }
            let read = Pin::new(&mut this.io).poll_read_buf(cx, &mut this.read_buf);
            match read {
                Poll::Pending => break,
                Poll::Ready(Ok(n)) => {
                    if n == 0 {
                        return Poll::Ready(Ok(()));
                    }
                }
                Poll::Ready(Err(_)) => return Poll::Ready(Err(())),
            }
        }

        if this.write_buf.capacity() - this.write_buf.len() < 8192 {
            this.write_buf.reserve(32_768);
        }

        loop {
            match this.codec.decode(&mut this.read_buf) {
                Ok(Some(h1::Message::Item(req))) => this.handle_request(req),
                Ok(None) => break,
                _ => return Poll::Ready(Err(())),
            }
        }

        if !this.write_buf.is_empty() {
            let len = this.write_buf.len();
            let mut written = 0;
            while written < len {
                match Pin::new(&mut this.io).poll_write(cx, &this.write_buf[written..]) {
                    Poll::Pending => {
                        if written > 0 {
                            this.write_buf.advance(written);
                        }
                        break;
                    }
                    Poll::Ready(Ok(n)) => {
                        if n == 0 {
                            return Poll::Ready(Ok(()));
                        } else {
                            written += n;
                        }
                    }
                    Poll::Ready(Err(_)) => return Poll::Ready(Err(())),
                }
            }
            if written > 0 {
                if written == len {
                    unsafe { this.write_buf.set_len(0) }
                } else {
                    this.write_buf.advance(written);
                }
            }
        }
        Poll::Pending
    }
}

#[actix_rt::main]
async fn main() -> io::Result<()> {
    println!("Started http server: 127.0.0.1:8080");

    // start http server
    Server::build()
        .backlog(1024)
        .bind("techempower", "0.0.0.0:8080", || {
            fn_service(|io: TcpStream| App {
                io,
                read_buf: BytesMut::with_capacity(32_768),
                write_buf: BytesMut::with_capacity(32_768),
                codec: h1::Codec::default(),
            })
        })?
        .start()
        .await
}
