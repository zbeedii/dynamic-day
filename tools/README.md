# Standalone helper tools

Generate Web Push VAPID keys with:

```bash
python tools/generate_vapid.py
```

For `VAPID_PUBLIC_KEY`, base64url-encode the uncompressed public key bytes. Keep the private key secret.
