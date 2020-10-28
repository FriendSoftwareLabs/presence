UPDATE invite_token AS i
SET i.type = 'public'
WHERE i.singleUse = 0;

UPDATE invite_token AS i
SET i.type = 'private'
WHERE i.singleUse = 1;