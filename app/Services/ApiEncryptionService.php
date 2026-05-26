<?php

namespace App\Services;

use RuntimeException;

class ApiEncryptionService
{
    public function generateToken(): string
    {
        return bin2hex(random_bytes(32));
    }

    public function generateKey(): string
    {
        return random_bytes(32);
    }

    /**
     * Encrypt plaintext with AES-256-GCM.
     * Returns base64-encoded iv, ciphertext, and auth tag separately
     * so the JS side can reconstruct them for SubtleCrypto.
     */
    public function encrypt(string $plaintext, string $key): array
    {
        $iv = random_bytes(12);
        $tag = '';

        $ciphertext = openssl_encrypt(
            $plaintext,
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            '',
            16
        );

        if ($ciphertext === false) {
            throw new RuntimeException('AES-256-GCM encryption failed');
        }

        return [
            'iv'   => base64_encode($iv),
            'data' => base64_encode($ciphertext),
            'tag'  => base64_encode($tag),
        ];
    }
}
