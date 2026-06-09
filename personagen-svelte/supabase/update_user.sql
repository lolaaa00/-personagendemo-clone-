BEGIN;
UPDATE auth.users 
SET email = 'monarchstackteam@gmail.com' 
WHERE email = 'client@personagen.ai';

UPDATE auth.identities 
SET identity_data = jsonb_set(identity_data, '{email}', '"monarchstackteam@gmail.com"')
WHERE email = 'client@personagen.ai';
COMMIT;
