-- Run this in Supabase SQL Editor ONLY IF you already ran the original
-- schema.sql before switching from MSG91 to APITXT. If you're setting up
-- a fresh project, just use the updated supabase/schema.sql instead —
-- don't run both.

alter table otp_requests add column if not exists code_hash text;
alter table otp_requests add column if not exists expires_at timestamptz;
alter table otp_requests add column if not exists consumed boolean not null default false;
alter table otp_requests add column if not exists attempts integer not null default 0;

-- Any rows from before this change have no code_hash/expires_at and are
-- meaningless now — clear them out so old dangling rows can't interfere
-- with the resend-cooldown check.
delete from otp_requests where code_hash is null;

alter table otp_requests alter column code_hash set not null;
alter table otp_requests alter column expires_at set not null;

create index if not exists otp_requests_phone_role_idx on otp_requests (phone, role, created_at desc);
