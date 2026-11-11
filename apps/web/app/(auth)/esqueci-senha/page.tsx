import { Suspense } from 'react';
import { AuthShell } from '@/components/app/AuthShell';
import { EsqueciSenhaForm } from '@/components/app/SenhaForms';

export default function EsqueciSenhaPage() {
  return (
    <AuthShell>
      <Suspense>
        <EsqueciSenhaForm />
      </Suspense>
    </AuthShell>
  );
}
