## 2024-05-24 - Timing Attack Vulnerability in Token Comparison
**Vulnerability:** Comparing sensitive tokens using `Buffer.length` check before `crypto.timingSafeEqual` or using regular `===`.
**Learning:** `timingSafeEqual` prevents timing attacks, but wrapping it in an early-return check on string/buffer length re-introduces the vulnerability because the attacker can learn the exact length of the required secret by observing timing differences.
**Prevention:** Instead of checking lengths, hash both user-provided input and the stored secret to a fixed length (e.g. using `crypto.createHash('sha256')`) and then securely compare the hashes.
