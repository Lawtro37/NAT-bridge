use argh::FromArgs;
use console::Term;
use peeroxide::{discovery_key, spawn, JoinOpts, SwarmConfig};

#[derive(FromArgs)]
/// nat-bridge <host|client> <bridge-id> [options]
struct Options {
    /// host or client
    #[argh(positional)]
    role: String,

    /// bridge id
    #[argh(positional)]
    bridge_id: String,

    /// port to listen on (default: 8080)
    #[argh(option, short = 'p', default = "8080")]
    port: u16,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let console = Term::stdout();
    console.write_line("NAT bridge")?;

    let opts: Options = argh::from_env();
    let topic = discovery_key(opts.bridge_id.as_bytes());

    if opts.role == "host" || opts.role == "client" {
        let config = SwarmConfig::with_public_bootstrap();
        let (_task, handle, mut conn_rx) = spawn(config).await?;

        handle.join(topic, JoinOpts::default()).await?;
        console.write_line(&format!("Joined as {} on port {}", opts.role, opts.port))?;

        while let Some(conn) = conn_rx.recv().await {
            console.write_line(&format!("Connected to peer: {:?}", conn.remote_public_key()))?;
        }
    } else if opts.role.trim().is_empty() || opts.role == "help" {
        let help = Options::from_args(&["NATbridge-rust"], &["--help"])
            .err()
            .map(|early_exit| early_exit.output)
            .unwrap_or_default();
        console.write_line(&help)?;
    } else {
        console.write_line("Invalid role. Use 'host' or 'client'.")?;
    }

    Ok(())
}
