import * as cdk from 'aws-cdk-lib';
import  * as transfer from 'aws-cdk-lib/aws-transfer';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Config } from "../config";
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaNodeJs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as cr from 'aws-cdk-lib/custom-resources'
import * as path from "path";
import {CustomResourceSftpTestProperties} from "./src/lambda/post-deploy-test-sftp";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as sns from "aws-cdk-lib/aws-sns";
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { CfnSchedule, CfnScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import { Effect, Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchactions from 'aws-cdk-lib/aws-cloudwatch-actions';

export type SftpStackProps = {
  config: Config;
}

export class SftpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, stackProps: cdk.StackProps, props: SftpStackProps) {
    super(scope, id, stackProps);

    function name(resourceId: string): string {
      return id + '-' + resourceId;
    }


    const createSftpStorage = () => {
      const sftpStorageBucket = new s3.Bucket(this, name("sftp-storage"), {
        bucketName: name("sftp-storage"),
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
      });

      const sftpUserRole = new iam.Role(this, name('user-role'), {
        assumedBy: new iam.ServicePrincipal("transfer.amazonaws.com"),
      });
      sftpUserRole.addToPrincipalPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucket'],
        resources: ['*'],
      }));
      sftpStorageBucket.grantReadWrite(sftpUserRole);

      return {
        sftpStorageBucket,
        sftpUserRole
      };
    }

    const createSftpServer = () => {
        const loggingRole = new iam.Role(this, `LoggingRole`, {
          assumedBy: new iam.ServicePrincipal("transfer.amazonaws.com"),
        });
        loggingRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSTransferLoggingAccess"));

        const sftpServer = new transfer.CfnServer(this, name("server"), {
          tags: [
            {key: 'name', value: name("server")},
          ],
          domain: 'S3',
          endpointType: 'PUBLIC',
          identityProviderType: 'SERVICE_MANAGED',
          loggingRole: loggingRole.roleArn,
          protocols: ['SFTP'],
          certificate: props.config.domain?.certificateArn,
        });
        const sftpDomain = `${sftpServer.attrServerId}.server.transfer.${props.config.awsEnv.region}.amazonaws.com`;

        let sftpServerHost = sftpDomain;
        if (props.config.domain) {
          const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this,  name("hosted-zone"), {
            hostedZoneId: props.config.domain.hostedZone.id,
            zoneName: props.config.domain.hostedZone.name
          });

          sftpServerHost = `${props.config.domain.subdomain}.${hostedZone.zoneName}`;
          new route53.CnameRecord(this, name("sftp-cname"), {
            recordName: sftpServerHost,
            domainName: sftpDomain,
            zone: hostedZone,
          });
        }
        new cdk.CfnOutput(this, 'SFTP_HOST', { description: 'SFTP_HOST', value: sftpServerHost });

        return {
          sftpServer,
          sftpServerHost
        }
      }

    const createSftpUser = (sftpServer: transfer.CfnServer, sftpStorageBucket: s3.Bucket, sftpUserRole: iam.Role,
                            userName: string, homeDirectory: string, publicKey: string) => {
      const userPolicy = (new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            sid: "ListOwnDirectory",
            effect: iam.Effect.ALLOW,
            actions: ['s3:ListBucket'],
            resources: ['arn:aws:s3:::${transfer:HomeBucket}'],
            conditions: {
              StringLike: {
                's3:prefix': [
                  '${transfer:HomeFolder}/*',
                  '${transfer:HomeFolder}'
                ]
              }
            }
          }),
          new iam.PolicyStatement({
            sid: "AccessHomeDirectory",
            effect: iam.Effect.ALLOW,
            actions: ['s3:PutObject', 's3:GetObject', 's3:GetObjectVersion'],
            resources: ['arn:aws:s3:::${transfer:HomeDirectory}*']
          })
        ]
      })).toJSON();

      const sftpUser = new transfer.CfnUser(this, name('user-'+userName), {
        userName, //TODO: Add validation for this later to catch at build time
        homeDirectory: "/" + sftpStorageBucket.bucketName + "/" + homeDirectory,
        sshPublicKeys: [publicKey],
        serverId: sftpServer.attrServerId,
        role: sftpUserRole.roleArn,
        policy: JSON.stringify(userPolicy)
      });
      sftpUser.node.addDependency(sftpUserRole);
      sftpUser.node.addDependency(sftpServer);

      return {
        sftpUser
      }
    }

    const createSftpTest = (sftpServer: transfer.CfnServer, sftpServerHost: string, sftpStorageBucket: s3.Bucket) => {
      const { sftpUser: sftpTestUser } = createSftpUser(sftpServer, sftpStorageBucket, sftpUserRole,
        props.config.testUser.username, props.config.testUser.homeDirectory, props.config.testUser.publicKey);

      const postDeployTestSftpCrHandler = new lambdaNodeJs.NodejsFunction(this,
          name("sftp-test-lambda"),
        {
        functionName: name("sftp-test-lambda"),
        timeout: cdk.Duration.minutes(3),
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(__dirname,"src/lambda/post-deploy-test-sftp/index.ts"),
        logRetention: logs.RetentionDays.ONE_DAY,
        bundling: {
          forceDockerBundling: false,
          minify: true,
          keepNames: true,
          sourceMapMode: lambdaNodeJs.SourceMapMode.DEFAULT,
          sourcesContent: false,
          nodeModules: ["ssh2-sftp-client"], //TODO: Optimize later, can not bundle easily
        },
        initialPolicy: [
          new iam.PolicyStatement({
            actions: ["secretsmanager:GetSecretValue"],
            resources: [
              cdk.Arn.format({ service: "secretsmanager", resource: "secret",
                resourceName: props.config.testUser.privateKeySecretName + "-*",
                arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME }, this)
            ]}),
        ],
      });
      sftpStorageBucket.grantReadWrite(postDeployTestSftpCrHandler);

      const postDeployTestSftpCrProvider = new cr.Provider(this, name("sftp-test-cr-provider"), {
        onEventHandler: postDeployTestSftpCrHandler,
        logRetention: logs.RetentionDays.ONE_DAY,
      });
      const customResourceProperties: CustomResourceSftpTestProperties = {
        physicalResourceId: Date.now().toString(),
        userName: props.config.testUser.username,
        privateKeySecretName: props.config.testUser.privateKeySecretName,
        sftpHost: sftpServerHost,
        bucketName: sftpStorageBucket.bucketName,
        homeFolder: props.config.testUser.homeDirectory,
      }
      const postDeployTestSftpCr = new cdk.CustomResource(this,  name("sftp-test-cr"), {
        resourceType: 'Custom::SftpTest',
        serviceToken: postDeployTestSftpCrProvider.serviceToken,
        properties: customResourceProperties,
      });

      postDeployTestSftpCr.node.addDependency(sftpTestUser);
      postDeployTestSftpCr.node.addDependency(sftpStorageBucket);
    }

    const createMissingDataLambda = (sftpStorageBucket: s3.Bucket, alarmTopic: sns.Topic) => {
      const checkMissingDataLambda = new lambdaNodeJs.NodejsFunction(this,
        name("check-missing-data-lambda"),
        {
          functionName: name("check-missing-data-lambda"),
          timeout: cdk.Duration.seconds(30),
          runtime: lambda.Runtime.NODEJS_18_X,
          entry: path.join(__dirname,"src/lambda/check-missing-data/index.ts"),
          logRetention: logs.RetentionDays.ONE_WEEK,
          bundling: {
            forceDockerBundling: false,
            minify: true,
            keepNames: true,
            sourceMapMode: lambdaNodeJs.SourceMapMode.DEFAULT,
            sourcesContent: false,
          },
          environment: {
            HOME_DIRECTORIES: props.config.agencyUsers.map(u => u.homeDirectory).join(","),
            SNS_ALERT_TOPIC: alarmTopic.topicArn,
            BUCKET_NAME: sftpStorageBucket.bucketName,
          },
        });
      sftpStorageBucket.grantRead(checkMissingDataLambda);
      alarmTopic.grantPublish(checkMissingDataLambda);

      // Create an Amazon EventBridge rule with a schedule
      new events.Rule(this, name("check-missing-data-lambda-rule"), {
        schedule: events.Schedule.cron({ minute: '0', hour: '14' }), // Trigger at 16:00 UTC every day
        targets: [new targets.LambdaFunction(checkMissingDataLambda)],
      });

      this.cwAlarmLambdaHardError(this, checkMissingDataLambda, new cloudwatchactions.SnsAction(alarmTopic));
    }

    const createSftpServerSchedule = (sftpServer: transfer.CfnServer, alarmTopic: sns.Topic) => {
      const schedulerDlq = new Queue(this, name('scheduler-dlq'), {
        queueName: name('scheduler-dlq'),
      });
      const schedulerRole = new Role(this, name('scheduler-role'), {
        assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
      });
      new Policy(this, name('scheduler-policy'), {
        policyName: 'ScheduleToStartStopTransferServers',
        roles: [schedulerRole],
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['transfer:StartServer', 'transfer:StopServer'],
            resources: [
              cdk.Arn.format({
                service: "transfer", resource: "server", resourceName: sftpServer.attrServerId,
              }, this)
            ]
          }),
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['sqs:SendMessage'],
            resources: [schedulerDlq.queueArn]
          })
        ],
      });

      const group = new CfnScheduleGroup(this, name('scheduler-group'), {
        name: name('scheduler-group')
      })

      /* Star instance at 08:00 UTC+02 */
      new CfnSchedule(this, name('schedule-start'), {
        groupName: group.name,
        flexibleTimeWindow: {
          mode: 'OFF',
        },
        scheduleExpression: `cron(0 8 ? * * *)`,
        scheduleExpressionTimezone: 'Africa/Johannesburg',
        description: 'Start Transfer Family Server',
        target: {
          retryPolicy: {
            maximumRetryAttempts: 1,
          },
          deadLetterConfig: {
            arn: schedulerDlq.queueArn,
          },
          arn: 'arn:aws:scheduler:::aws-sdk:transfer:startServer',
          roleArn: schedulerRole.roleArn,
          input: JSON.stringify({ ServerId: sftpServer.attrServerId }),
        },
      });

      /* Star instance at 17:00 UTC+02 */
      new CfnSchedule(this, name('schedule-stop'), {
        groupName: group.name,
        flexibleTimeWindow: {
          mode: 'OFF',
        },
        scheduleExpression: `cron(0 17 ? * * *)`,
        scheduleExpressionTimezone: 'Africa/Johannesburg',
        description: 'Stop Transfer Family Server',
        target: {
          retryPolicy: {
            maximumRetryAttempts: 1,
          },
          deadLetterConfig: {
            arn: schedulerDlq.queueArn,
          },
          arn: 'arn:aws:scheduler:::aws-sdk:transfer:stopServer',
          roleArn: schedulerRole.roleArn,
          input: JSON.stringify({ ServerId: sftpServer.attrServerId }),
        },
      });

      this.cwAlarmSqsVisibleMessages(this, schedulerDlq, new cloudwatchactions.SnsAction(alarmTopic));
    }



    const alarmTopic = new sns.Topic(this, name('alarm-topic'));
    new sns.Subscription(this, name('alarm-email-subscription'), {
      topic: alarmTopic,
      protocol: sns.SubscriptionProtocol.EMAIL,
      endpoint: props.config.alertMissingDataEmail,
    });

    const { sftpStorageBucket, sftpUserRole } = createSftpStorage();
    const { sftpServer, sftpServerHost} = createSftpServer();
    for (let user of props.config.agencyUsers) {
      createSftpUser(sftpServer, sftpStorageBucket, sftpUserRole, user.username, user.homeDirectory, user.publicKey);
    }
    createMissingDataLambda(sftpStorageBucket, alarmTopic);
    createSftpServerSchedule(sftpServer, alarmTopic);
    createSftpTest(sftpServer, sftpServerHost, sftpStorageBucket);

  }

  metricToAlarmId(scope: Construct, metric: cloudwatch.Metric) {
    return [scope.node.id, metric.metricName, 'Alarm'].join('-');
  }
  metricToAlarmName(scope: Construct, metric: cloudwatch.Metric) {
    return [scope.node.id, metric.namespace, metric.metricName].join('/');
  }
  cwAlarmLambdaHardError(scope: Construct, func: lambda.Function, cwAlarmAction: cloudwatchactions.SnsAction) {
    const metric = func.metricErrors({
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });

    let alarm = new cloudwatch.Alarm(scope, this.metricToAlarmId(func, metric), {
      metric: metric,
      alarmDescription: 'Lambda Hard Error - An error occurred and the function invocation failed.',
      actionsEnabled: true,
      alarmName: this.metricToAlarmName(func, metric),
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarm.addAlarmAction(cwAlarmAction);

    return alarm;
  }
  cwAlarmSqsVisibleMessages(scope: Construct, queue: Queue, cwAlarmAction: cloudwatchactions.SnsAction) {
    const metric = queue.metricApproximateNumberOfMessagesVisible({
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });

    let alarm = new cloudwatch.Alarm(scope, this.metricToAlarmId(queue, metric), {
      metric: metric,
      alarmDescription: 'SQS Visible Messages - The number of messages available for retrieval from the queue.',
      actionsEnabled: true,
      alarmName: this.metricToAlarmName(queue, metric),
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarm.addAlarmAction(cwAlarmAction);

    return alarm;
  }

}
