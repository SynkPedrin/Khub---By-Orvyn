import type { Request, Response, NextFunction } from 'express';

/**
 * Cabeçalhos de segurança (equivalente enxuto ao helmet, sem dependência).
 * A API só serve JSON — nada de CSP de página. HSTS só em produção (exige HTTPS).
 */
export function securityHeaders(nodeEnv: string) {
  const prod = nodeEnv === 'production';
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.removeHeader('X-Powered-By');
    if (prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
