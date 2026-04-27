#!/bin/sh
# MouseOps container entrypoint
# Handles cert generation and starts uvicorn in HTTP or HTTPS mode.
set -e

DATA_DIR="${MOUSEOPS_DATA_DIR:-/app/data}"
HTTP_PORT="${MOUSEOPS_HTTP_PORT:-8765}"
HTTPS_PORT="${MOUSEOPS_HTTPS_PORT:-8766}"
MODE="${MOUSEOPS_MODE:-https}"

# Ensure data subdirectories exist
mkdir -p "${DATA_DIR}/logs" "${DATA_DIR}/.ssl"

if [ "${MODE}" = "https" ]; then
    # Generate self-signed TLS cert if not already present
    if [ ! -f "${DATA_DIR}/.ssl/cert.pem" ] || [ ! -f "${DATA_DIR}/.ssl/key.pem" ]; then
        echo "Generating self-signed TLS certificate..."
        python3 - <<PYEOF
import datetime, ipaddress, os, stat
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

ssl_dir = Path(os.environ["MOUSEOPS_DATA_DIR"]) / ".ssl"
ssl_dir.mkdir(parents=True, exist_ok=True)

key  = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([
    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MouseOps"),
    x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
])
now  = datetime.datetime.now(datetime.timezone.utc)
cert = (
    x509.CertificateBuilder()
    .subject_name(name).issuer_name(name)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now)
    .not_valid_after(now + datetime.timedelta(days=3650))
    .add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
        ]), critical=False,
    )
    .sign(key, hashes.SHA256())
)
kp = ssl_dir / "key.pem"
cp = ssl_dir / "cert.pem"
kp.write_bytes(key.private_bytes(serialization.Encoding.PEM,
    serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
kp.chmod(stat.S_IRUSR | stat.S_IWUSR)
cp.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
print(f"Certificate written to {cp}")
PYEOF
    fi

    echo ""
    echo "MouseOps  [HTTPS mode]"
    echo "  HTTP  → http://0.0.0.0:${HTTP_PORT}  (redirects to HTTPS)"
    echo "  HTTPS → https://0.0.0.0:${HTTPS_PORT}"
    echo ""
    exec uvicorn main:app \
        --host 0.0.0.0 \
        --port "${HTTPS_PORT}" \
        --ssl-keyfile  "${DATA_DIR}/.ssl/key.pem" \
        --ssl-certfile "${DATA_DIR}/.ssl/cert.pem"
else
    echo ""
    echo "MouseOps  [HTTP mode]"
    echo "  http://0.0.0.0:${HTTP_PORT}"
    echo ""
    exec uvicorn main:app \
        --host 0.0.0.0 \
        --port "${HTTP_PORT}"
fi
