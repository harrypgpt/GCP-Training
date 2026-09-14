'use client';

import { useRouter } from 'next/navigation';
import { type JSX } from 'react';

import { RequireAdminRole } from '@/components/admin/require-admin-role';
import { AdminShell } from '@/components/admin/admin-shell';
import {
  QuestionForm,
  buildQuestionPayload,
  emptyQuestionForm,
  type QuestionFormValue,
} from '@/components/admin/question-form';
import { adminApi } from '@/lib/admin-api';

function NewQuestionForm(): JSX.Element {
  const router = useRouter();

  async function handleSubmit(value: QuestionFormValue): Promise<void> {
    const question = await adminApi.createQuestion(buildQuestionPayload(value));
    router.push(`/admin/questions/${question.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-serif text-2xl font-semibold text-foreground">New question</h1>
      <QuestionForm
        initial={emptyQuestionForm()}
        submitLabel="Create question"
        onSubmit={handleSubmit}
      />
    </div>
  );
}

export default function NewQuestionPage(): JSX.Element {
  return (
    <RequireAdminRole>
      <AdminShell>
        <NewQuestionForm />
      </AdminShell>
    </RequireAdminRole>
  );
}
