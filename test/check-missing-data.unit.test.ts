import { handler } from '../lib/src/lambda/check-missing-data';
import {
  ScheduledEvent
} from "aws-lambda";
import { configs } from "../config";
import {setAwsEnv} from "./helpers";

describe('Check Missing Data - Local Unit Tests', () => {

  const config = configs.dev;
  beforeAll(async () => {
    await setAwsEnv();
  })

  test('Fire', async () => {

    // const time = (new Date()).toISOString();
    const time = "2023-01-01T12:00:00Z";
    const scheduleEvent: ScheduledEvent = {
      account: "test-account",
      region: "test-region",
      detail: {},
      "detail-type": "Scheduled Event",
      source: "aws.events",
      time,
      id: "test-id",
      version: "test-version",
      resources: [],
    };

    // process.env.HOME_DIRECTORIES = "agency-1,test-automation"
    process.env.HOME_DIRECTORIES = config.agencyUsers.map(u => u.homeDirectory).join(",");
    process.env.SNS_ALERT_TOPIC = config.testOptions.snsAlertTopicArn;
    process.env.BUCKET_NAME = config.testOptions.bucketName;

    const resp = await handler(scheduleEvent);
  }, 1000 * 30);

  test('Delete Event', () => {

  });

});
