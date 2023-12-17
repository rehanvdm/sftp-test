import { handler } from '../lib/src/lambda/post-deploy-test-sftp';
import { CloudFormationCustomResourceEvent, CloudFormationCustomResourceResponseCommon } from "aws-lambda";
import { configs } from "../config";
import { fromIni } from "@aws-sdk/credential-providers";
import { CustomResourceSftpTestProperties } from "../lib/src/lambda/post-deploy-test-sftp";
import assert = require("assert");
import {setAwsEnv} from "./helpers";

describe('Post Deploy Test SFTP - Local Unit Tests', () => {

  const config = configs.dev;

  beforeAll(async () => {
    await setAwsEnv();
  })

  test('Create or Update Event', async () => {

    assert(config.testOptions.sftpHost, 'Missing required config.testOptions.sftpHost');
    assert(config.testOptions.bucketName, 'Missing required config.testOptions.bucketName');

    const customResourceProperties: CustomResourceSftpTestProperties = {
      physicalResourceId: Date.now().toString(),
      sftpHost: config.testOptions.sftpHost,
      userName: config.testUser.username,
      privateKeySecretName: config.testUser.privateKeySecretName,
      bucketName: config.testOptions.bucketName,
      homeFolder: config.testUser.homeDirectory,
    }
    const customResourceEvent: Omit<CloudFormationCustomResourceEvent, 'RequestType'> = {
      StackId: "test-stack-id",
      RequestId: "test-request-id",
      LogicalResourceId: "test-logical-resource-id",
      ResourceProperties: {
        ...customResourceProperties,
        ServiceToken: "xxx"
      },
      ServiceToken: "xxx",
      ResponseURL: "xxx",
      ResourceType: "xxx",
    };

    const createEvent: CloudFormationCustomResourceEvent = {
      ...customResourceEvent,
      RequestType: 'Create',
    };
    const resp = await handler(createEvent);
  }, 1000 * 30);

  test('Delete Event', () => {

  });

});
