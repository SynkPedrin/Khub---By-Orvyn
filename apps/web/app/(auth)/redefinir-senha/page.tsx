import { Suspense } from 'react';
import { AuthShell } from '@/components/app/AuthShell';
import { RedefinirSenhaForm } from '@/components/app/SenhaForms';

export default function RedefinirSenhaPage() {
  return (
    <AuthShell>
      <Suspense>
        <RedefinirSenhaForm />
      </Suspense>
    </AuthShell>
  );
}
