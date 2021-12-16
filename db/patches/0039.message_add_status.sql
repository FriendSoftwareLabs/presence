ALTER TABLE `message`
ADD COLUMN `status` VARCHAR(20) NULL
AFTER `statusId`;
