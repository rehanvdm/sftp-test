import { ScheduledEvent } from 'aws-lambda'
import {SNSClient, PublishCommand} from "@aws-sdk/client-sns";
import {S3Client, ListObjectsV2Command} from "@aws-sdk/client-s3";
import assert from "assert";

export const handler = async (event: ScheduledEvent): Promise<void> => {
  console.debug('event', event);

  assert(process.env.HOME_DIRECTORIES, "Missing HOME_DIRECTORIES env var");
  assert(process.env.SNS_ALERT_TOPIC, "Missing SNS_ALERT_TOPIC env var");
  assert(process.env.BUCKET_NAME, "Missing BUCKET_NAME env var");
  const homeDirectories = process.env.HOME_DIRECTORIES.split(",");
  const snsAlertTopic = process.env.SNS_ALERT_TOPIC;
  const bucketName = process.env.BUCKET_NAME;

  const today = (new Date()).toISOString().split("T")[0];
  const s3Client = new S3Client({ region: process.env.AWS_REGION });
  const snsClient = new SNSClient({ region: process.env.AWS_REGION });
  const missingHomeDirectoryDates: string[] = [];

  /* Check for files in each home directory for this day */
  for (const homeDirectory of homeDirectories) {
    const homeDirectoryDate = homeDirectory + "/" + today;
    console.debug(`Checking ${homeDirectoryDate}`)
    const s3Resp = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: homeDirectoryDate,
      MaxKeys: 1
    }));

    if (!s3Resp.Contents || s3Resp.Contents.length === 0) {
      missingHomeDirectoryDates.push(homeDirectory);
    }
  }

  /* If no files are found, send an SNS alert */
  if (missingHomeDirectoryDates.length > 0) {
    console.debug("Sending Alert for missing data: "+missingHomeDirectoryDates.join(","));
    await snsClient.send(new PublishCommand({
      TopicArn: snsAlertTopic,
      Subject: "Alert - Missing home directory files for: " + today,
      Message: "Please notify the following agencies that they have not uploaded files for today("+today+"):\n"
        + missingHomeDirectoryDates.join("\n"),
    }));
  }

  console.debug("Done")
}
