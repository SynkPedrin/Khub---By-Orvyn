import { Suspense } from 'react';
import { AuthShell } from '@/components/app/AuthShell';
import { SignupForm } from '@/components/app/SignupForm';

export default function SignupPage() {
  return (
    <AuthShell
      headlineLines={['Construa', 'sua operação de']}
      headlineAccent="receita."
      supportingCopy="Centralize o caminho entre o primeiro lead e a próxima oportunidade."
    >
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
