from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat

key = ec.generate_private_key(ec.SECP256R1())
private = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode().strip()
public_bytes = key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
import base64
public = base64.urlsafe_b64encode(public_bytes).rstrip(b'=') .decode()
print('VAPID_PRIVATE_KEY=')
print(private)
print('\nVAPID_PUBLIC_KEY=')
print(public)
print('\nThe printed VAPID_PUBLIC_KEY is ready to paste into the environment.')
