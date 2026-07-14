import { Suspense } from 'react';
import { AuthShell } from '@/components/app/AuthShell';
import { LoginForm } from '@/components/app/LoginForm';

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
