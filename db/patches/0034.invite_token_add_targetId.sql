ALTER TABLE `invite_token`
ADD COLUMN `targetId` VARCHAR( 191 ) NULL
AFTER `isValid`;