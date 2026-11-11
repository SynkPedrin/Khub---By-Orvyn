const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Personalização opcional do convite (ADR-0042). Tudo é escapado: vem de usuário. */
export interface ConvitePersonalizado {
  /** Nome de quem recebe ("Oi, Ana"). */
  convidado?: string | null;
  /** Quem convidou, para dar contexto ("Pedro convidou você"). */
  remetente?: string | null;
  /** Recado livre de quem convidou. */
  mensagem?: string | null;
}

export function invitationEmail(name: string, url: string, webUrl: string, agency = false, p: ConvitePersonalizado = {}) {
  const empresa = esc(name), link = esc(url), base = esc(webUrl.replace(/\/$/, ''));
  const saudacao = p.convidado ? `Oi, ${esc(p.convidado)}!` : `Bem-vindo a ${empresa}`;
  const quem = p.remetente ? `${esc(p.remetente)} convidou você` : 'Você foi convidado';
  const recado = p.mensagem ? `<p style="margin:20px 0 0;padding:16px 18px;border-left:3px solid #7b2eff;background:#f5f0ff;border-radius:8px;color:#3b3450;line-height:1.6;white-space:pre-line">${esc(p.mensagem)}</p>` : '';
  const subject = `Seu convite para ${name} · KHUB`;
  return {
    subject,
    text: `${p.convidado ? `Oi, ${p.convidado}!\n` : ''}${p.remetente ? `${p.remetente} convidou você para` : 'Você recebeu acesso à'} ${agency ? 'agência' : 'operação'} ${name} no KHUB.${p.mensagem ? `\n\n"${p.mensagem}"\n` : ''}\nAceite seu convite e crie sua senha: ${url}\nO link expira em 7 dias e é de uso único. Se já possui conta, use sua senha atual.`,
    html: `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5f3fa;font-family:Arial,sans-serif;color:#242032"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:40px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:auto;background:white;border-radius:24px;overflow:hidden"><tr><td style="padding:36px;background:#351065 url('${base}/Background-login.png') center/cover"><img src="${base}/logo-revenue.png" alt="KHUB" width="160" style="background:white;padding:12px;border-radius:12px"/><p style="color:#dbc9ff;font-size:12px;letter-spacing:3px;margin-top:32px">SUA PRÓXIMA OPERAÇÃO COMEÇA AQUI</p><h1 style="color:white;font-size:28px;margin-bottom:0">Você faz parte da equipe.</h1></td></tr><tr><td style="padding:36px"><h2 style="font-size:22px;margin-top:0">${saudacao}</h2><p style="line-height:1.7;color:#686078">${quem} para colaborar na ${agency ? 'agência' : 'operação'} <strong>${empresa}</strong> pelo KHUB. Ao abrir o link, você cria a sua senha e já entra.</p>${recado}<p style="margin:32px 0"><a href="${link}" style="display:inline-block;background:#7b2eff;color:white;padding:16px 26px;text-decoration:none;border-radius:12px;font-weight:bold">Aceitar convite →</a></p><p style="font-size:13px;color:#797184;line-height:1.7">Este convite expira em 7 dias e é de uso único. Já tem conta? Confirme sua senha para entrar.</p><p style="font-size:12px;word-break:break-all;color:#797184">${link}</p></td></tr></table><p style="text-align:center;font-size:11px;color:#92879e">KHUB · Sistemas para um crescimento real</p></td></tr></table></body></html>`,
  };
}
