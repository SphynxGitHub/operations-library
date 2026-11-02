-- AI features: a log of every AI run (used for shadow mode and for comparing with what people did).
-- Nothing here stores raw secrets: the function removes passwords and keys before the AI sees anything and before saving.
create table if not exists ai_runs (
    id text primary key,
    feature text not null,                 -- recap | email | email_review | holding_reply | test_scenarios | suggested_asks | lead_intent | howto | history
    mode text not null,                    -- shadow | suggest
    client_id text,
    source_kind text,                      -- gmail_message | calendar_event | task | resource | scoping
    source_id text,
    output jsonb,
    secrets_removed integer not null default 0,
    error text,
    created_by text,
    created_at timestamptz not null default now()
);
create index if not exists ai_runs_feature_idx on ai_runs (feature, created_at desc);
create index if not exists ai_runs_source_idx on ai_runs (source_kind, source_id);
alter table ai_runs enable row level security;
drop policy if exists ai_runs_all on ai_runs;
create policy ai_runs_all on ai_runs for all using (true) with check (true);
