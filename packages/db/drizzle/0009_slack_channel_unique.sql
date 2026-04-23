CREATE UNIQUE INDEX "channels_slack_channel_unique_idx" ON "channels" USING btree (("config"->>'slackChannelId')) WHERE "channels"."type" = 'slack';
