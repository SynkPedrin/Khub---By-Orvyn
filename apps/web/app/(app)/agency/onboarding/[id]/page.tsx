'use client';

import { useParams } from 'next/navigation';
import { OnboardingDetalhe } from '@/components/agency/onboarding/OnboardingDetalhe';

/** Detalhe do onboarding de uma subconta (abas em `?aba=`). */
export default function OnboardingDetalhePage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  if (!id) return null;
  return <OnboardingDetalhe id={id} />;
}
