import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse, CloudFormationCustomResourceResponseCommon,
} from 'aws-lambda'
import {SecretsManagerClient, GetSecretValueCommand} from "@aws-sdk/client-secrets-manager";
import {S3Client, GetObjectCommand, PutObjectCommand} from "@aws-sdk/client-s3";
import sftp from "ssh2-sftp-client";
import { v4 as uuidv4 } from 'uuid';

export type CustomResourceSftpTestProperties = {
  physicalResourceId: string;
  sftpHost: string;
  userName: string;
  privateKeySecretName: string;
  bucketName: string;
  homeFolder: string;
}

function getPropsFromEvents (event: CloudFormationCustomResourceEvent): CustomResourceSftpTestProperties {
  if (!event.ResourceProperties.physicalResourceId &&
    !event.ResourceProperties.sftpHost &&
    !event.ResourceProperties.userName &&
    !event.ResourceProperties.privateKeySecretName) {
    throw new Error('Missing required properties: physicalResourceId, userName and userSecret')
  }

  return {
    physicalResourceId: event.ResourceProperties.physicalResourceId,
    sftpHost: event.ResourceProperties.sftpHost,
    userName: event.ResourceProperties.userName,
    privateKeySecretName: event.ResourceProperties.privateKeySecretName,
    bucketName: event.ResourceProperties.bucketName,
    homeFolder: event.ResourceProperties.homeFolder,
  }
}

export const handler = async (event: CloudFormationCustomResourceEvent): Promise<CloudFormationCustomResourceResponse> => {
  console.debug('event', event);

  const cdkCustomResponse: Omit<CloudFormationCustomResourceResponseCommon, 'PhysicalResourceId' > = {
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
  };

  try {
    switch (event.RequestType) {
      case 'Create':
      case 'Update':
        const props = getPropsFromEvents(event);

        const sftpClient = await connectSftp(props);
        await testCanReadAndWrite(sftpClient, props);
        await testCanOnlyReadOwnHomeFolder(sftpClient, props);

        return {
          ...cdkCustomResponse,
          Status: 'SUCCESS',
          PhysicalResourceId: props.physicalResourceId,
          Data: { }
        };

      case 'Delete':
        /* Don't test on delete, just pass */
        return {
          ...cdkCustomResponse,
          Status: 'SUCCESS',
          PhysicalResourceId: event.PhysicalResourceId, // Use existing
        };
    }
  } catch (err: unknown) {
    console.error(err);
    throw err;
  }
}

async function connectSftp(props: CustomResourceSftpTestProperties)
{
  /* Read the test-automation private key from Secrets Manager */
  console.debug("Getting secret")
  const secretsManagerClient = new SecretsManagerClient({ region: process.env.AWS_REGION })
  const privateKeySecretResp = await secretsManagerClient.send(new GetSecretValueCommand({
    SecretId: props.privateKeySecretName
  }));

  /* Connect and upload a file to SFTP */
  console.debug("Connecting to SFTP")
  const sftpClient = new sftp();
  await sftpClient.connect({
    host: props.sftpHost,
    port: 22,
    username: props.userName,
    privateKey: privateKeySecretResp.SecretString,
  });

  return sftpClient;
}

async function testCanReadAndWrite(sftpClient: sftp, props: CustomResourceSftpTestProperties)
{
  console.debug("TEST: testCanReadAndWrite")

  const fileName = uuidv4();
  const fileContent = uuidv4();
  console.debug("Uploading file")
  await sftpClient.put(Buffer.from(fileContent), fileName);

  /* Wait so that we are sure the file is in the S3 bucket - might not be needed */
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  /* Read the file from S3 and if it exists and the content is the same, pass the test */
  console.debug("Comparing with S3 stored file")
  const s3Client = new S3Client({ region: process.env.AWS_REGION });
  const s3Resp = await s3Client.send(new GetObjectCommand({
    Bucket: props.bucketName,
    Key: props.homeFolder + "/" + fileName,
  }));
  const s3fileContent = await s3Resp.Body!.transformToString();

  if(s3fileContent !== fileContent)
    throw new Error(`File content mismatch. Expected: ${fileContent}, Actual: ${s3fileContent}`);

  console.debug("Pass - Can read and file contents match");
}

async function testCanOnlyReadOwnHomeFolder(sftpClient: sftp, props: CustomResourceSftpTestProperties)
{
  console.debug("TEST: testCanOnlyReadOwnHomeFolder")

  const fileName = "not-your-home-dir/test.txt";
  const fileContent = "should not be able to read this";

  /* Write a file to S3 that is outside the users home directory */
  console.debug("Uploading file outside home directory");
  const s3Client = new S3Client({ region: process.env.AWS_REGION });
  const s3Resp = await s3Client.send(new PutObjectCommand({
    Bucket: props.bucketName,
    Key: fileName,
    Body: Buffer.from(fileContent),
  }));

  /* Wait so that we are sure the file is in the S3 bucket - might not be needed */
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  try {
    const file = await sftpClient.get(fileName);
    throw new Error('Should not be able to read the file outside home directory');
  }
  catch (err: unknown) {
    // console.debug(err);
    console.debug("Pass - Can not read file outside home directory");
  }

}