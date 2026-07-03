/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: {
      id: string;
      email: string;
      displayName: string | null;
      avatarUrl: string | null;
    } | null;
    adminUser: {
      userId: string;
      email: string;
      displayName: string | null;
      role: 'owner' | 'ops' | 'trip_lead';
      tripIds: string[];
    } | null;
  }
}

interface ImportMetaEnv {
  readonly RESEND_API_KEY?: string;
  readonly EMAIL_FROM?: string;
  readonly ADMIN_EMAIL?: string;
  readonly ANALYTICS_LLM_PROVIDER?: 'anthropic' | 'openai' | 'test';
  readonly ANALYTICS_LLM_MODEL?: string;
  readonly ANALYTICS_LLM_API_KEY?: string;
  readonly ANALYTICS_LLM_FAKE_RESPONSE?: string;
}
