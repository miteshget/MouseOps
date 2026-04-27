#!/bin/bash
# Usage:
#   bash run.sh           → HTTPS on :8766 + HTTP redirect on :8765 (default)
#   bash run.sh --http    → HTTP only on :8765  (no SSL, no redirect)
#   bash run.sh --https   → HTTPS on :8766 + HTTP redirect on :8765
#
# Port overrides: MOUSEOPS_HTTP_PORT=80 MOUSEOPS_HTTPS_PORT=443 bash run.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# ── Parse mode flag ───────────────────────────────────────────────────────────
MODE="${MOUSEOPS_PROTOCOL:-https}"
for arg in "$@"; do
    case "$arg" in
        --http)  MODE=http  ;;
        --https) MODE=https ;;
    esac
done

# ── React build ───────────────────────────────────────────────────────────────
if [ ! -f "static/index.html" ] || [ "${SKIP_BUILD}" != "1" ]; then
    echo "Building React frontend..."
    bash "$DIR/build.sh"
fi

# ── Python venv ───────────────────────────────────────────────────────────────
if [ ! -d ".venv" ]; then
    echo "Creating Python virtualenv..."
    python3 -m venv .venv
fi
# Always sync so newly added packages (e.g. cryptography) are installed
.venv/bin/pip install -q -r requirements.txt

# ── Ports ─────────────────────────────────────────────────────────────────────
HTTP_PORT="${MOUSEOPS_HTTP_PORT:-8765}"
HTTPS_PORT="${MOUSEOPS_HTTPS_PORT:-8766}"

# ── Start ─────────────────────────────────────────────────────────────────────
if [ "$MODE" = "http" ]; then
    echo ""
    echo "MouseOps  [HTTP mode]"
    echo "  http://127.0.0.1:${HTTP_PORT}"
    echo ""
    export MOUSEOPS_MODE=http
    exec .venv/bin/uvicorn main:app \
        --host 0.0.0.0 \
        --port "${HTTP_PORT}"
else
    export MOUSEOPS_MODE=https

    # ── Generate self-signed TLS cert if missing ──────────────────────────────
    if [ ! -f ".ssl/cert.pem" ] || [ ! -f ".ssl/key.pem" ]; then
        echo "Generating self-signed TLS certificate..."
        .venv/bin/python3 - <<'PYEOF'
import datetime, ipaddress, stat
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

ssl_dir = Path(".ssl")
ssl_dir.mkdir(exist_ok=True)

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
subject = issuer = x509.Name([
    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MouseOps"),
    x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
])
cert = (
    x509.CertificateBuilder()
    .subject_name(subject)
    .issuer_name(issuer)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
    .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
    .add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
        ]),
        critical=False,
    )
    .sign(key, hashes.SHA256())
)
key_path  = ssl_dir / "key.pem"
cert_path = ssl_dir / "cert.pem"
key_path.write_bytes(key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.TraditionalOpenSSL,
    encryption_algorithm=serialization.NoEncryption(),
))
key_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
print(f"Certificate written to {cert_path}")
PYEOF

        # Verify cert was actually created
        if [ ! -f ".ssl/cert.pem" ] || [ ! -f ".ssl/key.pem" ]; then
            echo ""
            echo "ERROR: TLS certificate generation failed."
            echo "Try HTTP mode instead: bash run.sh --http"
            exit 1
        fi
    fi

    echo ""
    echo "MouseOps  [HTTPS mode]"
    echo "  HTTP  → http://127.0.0.1:${HTTP_PORT}  (redirects to HTTPS)"
    echo "  HTTPS → https://127.0.0.1:${HTTPS_PORT}"
    echo "  Note: browser will warn about self-signed cert — click Advanced → Proceed"
    echo ""
    exec .venv/bin/uvicorn main:app \
        --host 0.0.0.0 \
        --port "${HTTPS_PORT}" \
        --ssl-keyfile  .ssl/key.pem \
        --ssl-certfile .ssl/cert.pem
fi
