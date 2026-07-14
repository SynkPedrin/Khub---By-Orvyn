import { Suspense } from 'react';
import { AuthShell } from '@/components/app/AuthShell';
import { SignupForm } from '@/components/app/SignupForm';

export default function SignupPage() {
  return (
    <AuthShell>
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
