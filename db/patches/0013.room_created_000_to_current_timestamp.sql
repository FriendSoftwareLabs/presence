UPDATE `room`
SET `created` = CURRENT_TIMESTAMP
WHERE `created` = 0;