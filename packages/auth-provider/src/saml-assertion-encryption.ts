import { createRequire } from "module";

const require = createRequire(import.meta.url);
const xmlenc = require("xml-encryption") as {
  encrypt: (
    content: string,
    options: {
      pem: Buffer | string;
      rsa_pub: Buffer | string;
      encryptionAlgorithm?: string;
      keyEncryptionAlgorithm?: string;
      keyEncryptionDigest?: string;
      disallowEncryptionWithInsecureAlgorithm?: boolean;
    },
    callback: (err: Error | null, result: string) => void
  ) => void;
};

const XMLNS_SAML = "urn:oasis:names:tc:SAML:2.0:assertion";

function formatPem(key: string, type: string): string {
  if (/-----BEGIN [0-9A-Z ]+-----[^-]*-----END [0-9A-Z ]+-----/g.exec(key)) {
    return key;
  }
  const trimmed = key.replace(/\s/g, "");
  const lines = trimmed.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${type.toUpperCase()}-----\n${lines.join("\n")}\n-----END ${type.toUpperCase()}-----`;
}

export function encryptAssertion(assertionXml: string, spCertificatePem: string): Promise<string> {
  const certPem = formatPem(spCertificatePem, "CERTIFICATE");
  const certBuffer = Buffer.from(certPem, "utf8");
  return new Promise((resolve, reject) => {
    xmlenc.encrypt(
      assertionXml,
      {
        pem: certBuffer,
        rsa_pub: certBuffer,
        encryptionAlgorithm: "http://www.w3.org/2001/04/xmlenc#aes128-cbc",
        keyEncryptionAlgorithm: "http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p",
        keyEncryptionDigest: "sha1",
        disallowEncryptionWithInsecureAlgorithm: true,
      },
      (err: Error | null, encryptedData: string) => {
        if (err) reject(err);
        else resolve(`<saml:EncryptedAssertion xmlns:saml="${XMLNS_SAML}">${encryptedData}</saml:EncryptedAssertion>`);
      }
    );
  });
}
