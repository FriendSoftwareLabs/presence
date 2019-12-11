ALTER TABLE `account`
ADD COLUMN `fLastUpdate` BIGINT NULL
AFTER `fUsername`;