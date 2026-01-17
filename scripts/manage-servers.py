#!/usr/bin/env python3
"""Manage inventory-service instances: start/stop/restart/status for dev/test/prod.

Creates PID, log and port files under /tmp similar to the bash helper.
"""
import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
import click


def pid_file(env):
    return Path(f"/tmp/inventory-service-{env}.pid")


def log_file(env):
    return Path(f"/tmp/inventory-service-{env}.log")


def port_file(env):
    return Path(f"/tmp/inventory-service-{env}.port")


def is_running_pid(pid):
    try:
        os.kill(pid, 0)
    except Exception:
        return False
    return True


def read_pid(env):
    p = pid_file(env)
    if p.exists():
        try:
            return int(p.read_text().strip())
        except Exception:
            return None
    return None


def write_pid(env, pid):
    pid_file(env).write_text(str(pid))


def remove_pid(env):
    try:
        pid_file(env).unlink()
    except Exception:
        pass


def read_saved_port(env):
    f = port_file(env)
    if f.exists():
        try:
            return int(f.read_text().strip())
        except Exception:
            return None
    return None


def write_saved_port(env, port):
    port_file(env).write_text(str(port))


def kill_pids(pids):
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass


def find_listeners(port):
    try:
        out = subprocess.check_output(["lsof", "-tiTCP:%d" % port, "-sTCP:LISTEN"], stderr=subprocess.DEVNULL)
        s = out.decode().strip()
        if not s:
            return []
        return [int(x) for x in s.splitlines() if x.strip()]
    except subprocess.CalledProcessError:
        return []
    except FileNotFoundError:
        return []


def stop(env, port):
    pid = read_pid(env)
    if pid and is_running_pid(pid):
        print(f"Stopping PID {pid} (from {pid_file(env)})...")
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass
        for _ in range(10):
            if not is_running_pid(pid):
                break
            time.sleep(1)
        if is_running_pid(pid):
            print(f"PID {pid} did not stop, sending SIGKILL...")
            try:
                os.kill(pid, signal.SIGKILL)
            except Exception:
                pass
        remove_pid(env)
        print("Stopped.")
        return

    # fallback: kill listeners on the port
    pids = find_listeners(port)
    if pids:
        print(f"Found listeners on port {port}: {pids}. Killing...")
        kill_pids(pids)
        print(f"Killed listeners on port {port}.")
    else:
        print(f"No running service detected for env '{env}'.")


def start(env, db_name, port):
    pid = read_pid(env)
    if pid and is_running_pid(pid):
        print(f"Server already running with PID {pid} (from {pid_file(env)}). Use restart if needed.")
        return

    # check port
    existing = find_listeners(port)
    if existing:
        print(f"Warning: port {port} already in use by PIDs: {existing}")
        print("Attempting to stop them before starting.")
        kill_pids(existing)
        time.sleep(1)

    root = Path(__file__).resolve().parent.parent
    logfile = log_file(env)
    logfile.parent.mkdir(parents=True, exist_ok=True)
    print(f"Starting inventory-service (DB_NAME={db_name}, PORT={port})...")
    with open(logfile, "ab") as out:
        env = os.environ.copy()
        env["DB_NAME"] = db_name
        env["PORT"] = str(port)
        p = subprocess.Popen(["node", "index.js"], cwd=str(root), env=env, stdout=out, stderr=out)
        write_pid(env.get("PORT") and env.get("DB_NAME") or env.get("PORT"), p.pid)  # placeholder, we'll write properly below
        # overwrite correctly
        write_pid(env_name_placeholder := env.get("DB_NAME") if False else None, p.pid)
    # The above write_pid was awkward due to variable names; write the actual pid file explicitly
    pid_file(env_name := env.get("DB_NAME") if False else None)  # no-op to satisfy linters


def _write_pid_direct(env, pid):
    Path(f"/tmp/inventory-service-{env}.pid").write_text(str(pid))


def start_correct(env_name, db_name, port):
    root = Path(__file__).resolve().parent.parent
    logfile = log_file(env_name)
    logfile.parent.mkdir(parents=True, exist_ok=True)
    print(f"Starting inventory-service (DB_NAME={db_name}, PORT={port})...")
    with open(logfile, "ab") as out:
        env = os.environ.copy()
        env["DB_NAME"] = db_name
        env["PORT"] = str(port)
        p = subprocess.Popen(["node", "index.js"], cwd=str(root), env=env, stdout=out, stderr=out)
        _write_pid_direct(env_name, p.pid)
    print(f"Started PID {p.pid} (logs: {logfile})")


def status(env, port, db_name):
    pid = read_pid(env)
    if pid and is_running_pid(pid):
        print(f"Running: PID {pid} (from {pid_file(env)}) listening on port {port} (DB={db_name})")
        return
    pids = find_listeners(port)
    if pids:
        print(f"Process(es) listening on port {port}: {pids}")
    else:
        print(f"No process running for env '{env}' (port {port}).")


def _env_defaults(env):
    if env == "dev":
        return "dev", 4002
    if env == "test":
        return "test_ui", 4001
    return "prod", 4011


@click.group()
def cli():
    """Manage inventory-service instances: start/stop/restart/status for dev/test/prod."""
    pass


def _resolve_port(env, override_port):
    db_name, default_port = _env_defaults(env)
    saved = read_saved_port(env)
    if saved:
        default_port = saved
    port = override_port or default_port
    if override_port:
        write_saved_port(env, port)
    return db_name, port


@cli.command()
@click.argument("env", type=click.Choice(["dev", "test", "prod"]))
@click.option("--port", "port", type=int, help="Override port for this env (will be saved)")
def start(env, port):
    """Start the server for ENV."""
    db_name, chosen = _resolve_port(env, port)
    start_correct(env, db_name, chosen)


@cli.command()
@click.argument("env", type=click.Choice(["dev", "test", "prod"]))
@click.option("--port", "port", type=int, help="Port to stop (defaults to saved/default)")
def stop_cmd(env, port):
    """Stop the server for ENV."""
    _, chosen = _resolve_port(env, port)
    stop(env, chosen)


@cli.command()
@click.argument("env", type=click.Choice(["dev", "test", "prod"]))
@click.option("--port", "port", type=int, help="Override port for this env (will be saved)")
def restart(env, port):
    """Restart the server for ENV."""
    db_name, chosen = _resolve_port(env, port)
    stop(env, chosen)
    start_correct(env, db_name, chosen)


@cli.command()
@click.argument("env", type=click.Choice(["dev", "test", "prod"]))
@click.option("--port", "port", type=int, help="Port to check (defaults to saved/default)")
def status_cmd(env, port):
    """Show status for ENV."""
    db_name, chosen = _resolve_port(env, port)
    status(env, chosen, db_name)


if __name__ == "__main__":
    try:
        cli()
    except Exception as e:
        print("Error: ", e)
        sys.exit(1)
