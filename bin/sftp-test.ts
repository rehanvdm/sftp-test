#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SftpStack } from '../lib/sftp-stack';
import {Config, configs, Environment, ENVIRONMENTS} from "../config";
import assert = require("assert");
import {Tags} from "aws-cdk-lib";
import path from "path";
import fs from "fs";
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  SecretsManagerClient,
  UpdateSecretCommand
} from "@aws-sdk/client-secrets-manager";
import {fromIni} from "@aws-sdk/credential-providers";

const app = new cdk.App();

/* Get the config from passed in command line context variable */
const env = app.node.tryGetContext('env');
assert(env, 'env context variable is required, specify either `-c env=dev` or `-c env=prod`');
assert(ENVIRONMENTS.includes(env), `invalid env context variable, must be one of ${ENVIRONMENTS.join(', ')}`);
const config: Config = configs[env as Environment];

/**
 * Create the Test Automation Private Key from GitHub environment secret (TEST_AUTOMATION_PRIVATE_KEY_VALUE)
 * or the local file at `../private-keys/test_automation` depending on execution environment.
 * This operation is Idempotent.
 */
async function createTestAutomationSecret() {
  let secretValueFile;
  let secretsManagerClient;
  if(process.env.CI) {
    secretsManagerClient = new SecretsManagerClient({ region: config.awsEnv.region }); // Use the AWS ENV vars from the CI
    assert(process.env.TEST_AUTOMATION_PRIVATE_KEY_VALUE, 'Missing required environment variable TEST_AUTOMATION_PRIVATE_KEY_VALUE');
    secretValueFile = process.env.TEST_AUTOMATION_PRIVATE_KEY_VALUE;
  } else {
    secretsManagerClient = new SecretsManagerClient({
      region: config.awsEnv.region,
      credentials: fromIni({ profile: process.env.AWS_PROFILE }) // Use the AWS ENV as set in package.json
    });

    const secretPrivateKey = path.resolve(__dirname, '../private-keys/test_automation');
    assert(fs.existsSync(secretPrivateKey), 'Missing required private key file private-keys/test_automation');
    secretValueFile = fs.readFileSync(secretPrivateKey, {encoding: 'utf8'});
  }

  let secretExist: boolean;
  try {
    await secretsManagerClient.send(new GetSecretValueCommand({
      SecretId: config.testUser.privateKeySecretName
    }));
    secretExist = true;
  } catch (e: any) {
    if(e.name === 'ResourceNotFoundException')
      secretExist = false;
    else
      throw e;
  }

  if(secretExist) {
    await secretsManagerClient.send(new UpdateSecretCommand({
      SecretId: config.testUser.privateKeySecretName,
      SecretString: secretValueFile
    }));
  }
  else {
    await secretsManagerClient.send(new CreateSecretCommand({
      Name: config.testUser.privateKeySecretName,
      SecretString: secretValueFile
    }));
  }
}

async function main()
{
  /* Create resource needed before CDK should run */
  console.info('Creating Test Automation Secret')
  await createTestAutomationSecret();

  /* Create CDK stacks */
  console.info('Creating Stacks')
  const sftpStack = new SftpStack(app, 'sftp-tha-rehan-'+config.env, {
      env: config.awsEnv,
      tags: {
        owner: 'rehan-van-der-merwe',
        project: 'sftp-tha',
        environment: config.env,
      }
    },
    {
      config: config
    });
}
main();

