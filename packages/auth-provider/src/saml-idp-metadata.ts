const XMLNS_MD = "urn:oasis:names:tc:SAML:2.0:metadata";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function certToBase64(pemOrCert: string): string {
  const trimmed = pemOrCert
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s/g, "");
  return trimmed;
}

export interface IdpMetadataConfig {
  entityId: string;
  ssoLoginUrl: string;
  ssoLogoutUrl?: string;
  signingCertificates: string[];
  encryptionCertificates?: string[];
  nameIdFormats?: string[];
}

export function getIdpMetadataXml(config: IdpMetadataConfig): string {
  const signingCerts = config.signingCertificates.map((c) => certToBase64(c));
  const encryptionCerts = (config.encryptionCertificates ?? []).map((c) => certToBase64(c));
  const nameIdFormats = config.nameIdFormats ?? ["urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified"];

  const keyDescriptors: string[] = [];
  for (const cert of signingCerts) {
    keyDescriptors.push(
      `<md:KeyDescriptor use="signing" xmlns:md="${XMLNS_MD}"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${cert}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`
    );
  }
  for (const cert of encryptionCerts) {
    keyDescriptors.push(
      `<md:KeyDescriptor use="encryption" xmlns:md="${XMLNS_MD}"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${cert}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`
    );
  }

  const nameIdFormatEls = nameIdFormats
    .map((f) => `<md:NameIDFormat xmlns:md="${XMLNS_MD}">${escapeXml(f)}</md:NameIDFormat>`)
    .join("");

  const ssoRedirect = `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${escapeXml(config.ssoLoginUrl)}" xmlns:md="${XMLNS_MD}"/>`;
  const ssoPost = `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(config.ssoLoginUrl)}" xmlns:md="${XMLNS_MD}"/>`;

  let sloSection = "";
  if (config.ssoLogoutUrl) {
    sloSection = `<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${escapeXml(config.ssoLogoutUrl)}" xmlns:md="${XMLNS_MD}"/>`;
  }

  const descriptor = `<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:md="${XMLNS_MD}">
${keyDescriptors.join("\n")}
${nameIdFormatEls}
${ssoRedirect}
${ssoPost}
${sloSection}
</md:IDPSSODescriptor>`;

  return `<?xml version="1.0" encoding="UTF-8"?><md:EntityDescriptor entityID="${escapeXml(config.entityId)}" xmlns:md="${XMLNS_MD}">
${descriptor}
</md:EntityDescriptor>`;
}
