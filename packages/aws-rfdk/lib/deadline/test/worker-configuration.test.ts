/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable dot-notation */

import {
  expect as expectCDK,
  haveResource,
  haveResourceLike,
} from '@aws-cdk/assert';
import {
  AmazonLinuxGeneration,
  Instance,
  InstanceType,
  IVpc,
  MachineImage,
  SecurityGroup,
  Vpc,
  WindowsVersion,
} from '@aws-cdk/aws-ec2';
import {
  ContainerImage,
} from '@aws-cdk/aws-ecs';
import {
  ILogGroup,
} from '@aws-cdk/aws-logs';
import {
  Stack,
} from '@aws-cdk/core';
import {
  LogGroupFactoryProps,
} from '../../core/lib';
import {
  RenderQueue,
  Repository,
  Version,
  VersionQuery,
  WorkerInstanceConfiguration,
} from '../lib';
import {
  linuxConfigureWorkerScriptBoilerplate,
  linuxCloudWatchScriptBoilerplate,
  windowsConfigureWorkerScriptBoilerplate,
  windowsCloudWatchScriptBoilerplate,
} from './asset-constants';

describe('Test WorkerInstanceConfiguration for Linux', () => {
  let stack: Stack;
  let vpc: IVpc;
  let instance: Instance;

  beforeEach(() => {
    stack = new Stack();
    vpc = new Vpc(stack, 'Vpc');
    instance = new Instance(stack, 'Instance', {
      vpc,
      instanceType: new InstanceType('t3.small'),
      machineImage: MachineImage.latestAmazonLinux({ generation: AmazonLinuxGeneration.AMAZON_LINUX_2 }),
    });
  });

  test('basic setup', () => {
    // WHEN
    new WorkerInstanceConfiguration(stack, 'Config', {
      worker: instance,
    });
    const userData = stack.resolve(instance.userData.render());

    // // THEN
    expect(userData).toStrictEqual({
      'Fn::Join': [
        '',
        [
          '#!/bin/bash\nmkdir -p $(dirname \'/tmp/',
          ...linuxConfigureWorkerScriptBoilerplate(
            `\' \'\' \'\' \'\' \'${Version.MINIMUM_SUPPORTED_DEADLINE_VERSION.toString()}\' ${WorkerInstanceConfiguration['DEFAULT_LISTENER_PORT']} /tmp/`),
        ],
      ],
    });
  });

  test('custom listener port', () => {
    const otherListenerPort = 55555;

    // WHEN
    new WorkerInstanceConfiguration(stack, 'Config', {
      worker: instance,
      workerSettings: {
        listenerPort: otherListenerPort,
      },
    });
    const userData = stack.resolve(instance.userData.render());

    // // THEN
    expect(userData).toStrictEqual({
      'Fn::Join': [
        '',
        [
          '#!/bin/bash\nmkdir -p $(dirname \'/tmp/',
          ...linuxConfigureWorkerScriptBoilerplate(`\' \'\' \'\' \'\' \'${Version.MINIMUM_SUPPORTED_DEADLINE_VERSION.toString()}\' ${otherListenerPort} /tmp/`),
        ],
      ],
    });
  });

  test('groups, pools, region setup', () => {
    // WHEN
    new WorkerInstanceConfiguration(stack, 'Config', {
      worker: instance,
      workerSettings: {
        groups: ['g1', 'g2'],
        pools: ['p1', 'p2'],
        region: 'r1',
      },
    });
    const userData = stack.resolve(instance.userData.render());

    // // THEN
    expect(userData).toStrictEqual({
      'Fn::Join': [
        '',
        [
          '#!/bin/bash\nmkdir -p $(dirname \'/tmp/',
          ...linuxConfigureWorkerScriptBoilerplate(
            `\' \'g1,g2\' \'p1,p2\' \'r1\' \'${Version.MINIMUM_SUPPORTED_DEADLINE_VERSION.toString()}\' ${WorkerInstanceConfiguration['DEFAULT_LISTENER_PORT']} /tmp/`),
        ],
      ],
    });
  });

  test('log setup', () => {
    // GIVEN
    const logGroupProps: LogGroupFactoryProps = {
      logGroupPrefix: '/test-prefix/',
    };

    // WHEN
    const config = new WorkerInstanceConfiguration(stack, 'Config', {
      worker: instance,
      cloudWatchLogSettings: logGroupProps,
    });
    const logGroup = config.node.findChild('ConfigLogGroupWrapper');
    const logGroupName = stack.resolve((logGroup as ILogGroup).logGroupName);
    const userData = stack.resolve(instance.userData.render());

    // THEN
    expect(userData).toStrictEqual({
      'Fn::Join': [
        '',
        [
          '#!/bin/bash\nmkdir -p $(dirname \'/tmp/',
          ...linuxCloudWatchScriptBoilerplate(
            `\' \'\' \'\' \'\' \'${Version.MINIMUM_SUPPORTED_DEADLINE_VERSION.toString()}\' ${WorkerInstanceConfiguration['DEFAULT_LISTENER_PORT']} /tmp/`),
        ],
      ],
    });

    expectCDK(stack).to(haveResource('AWS::SSM::Parameter', {
      Value: {
        'Fn::Join': [
          '',
          [
            '{\"logs\":{\"logs_collected\":{\"files\":{\"collect_list\":[{\"log_group_name\":\"',
            logGroupName,
            '\",\"log_stream_name\":\"cloud-init-output-{instance_id}\",\"file_path\":\"/var/log/cloud-init-output.log\",\"timezone\":\"Local\"},{\"log_group_name\":\"',
            logGroupName,
            '\",\"log_stream_name\":\"WorkerLogs-{instance_id}\",\"file_path\":\"/var/log/Thinkbox/Deadline10/deadlineslave*.log\",\"timezone\":\"Local\"},{\"log_group_name\":\"',
            logGroupName,
            '\",\"log_stream_name\":\"LauncherLogs-{instance_id}\",\"file_path\":\"/var/log/Thinkbox/Deadline10/deadlinelauncher*.log\",\"timezone\":\"Local\"}]}},\"log_stream_name\":\"DefaultLogStream-{instance_id}\",\"force_flush_interval\":15}}',
          ],
        ],
      },
    }));
  });
});

describe('Test WorkerInstanceConfiguration for Windows', () => {
  let stack: Stack;
  let vpc: IVpc;
  let instance: Instance;

  beforeEach(() => {
    stack = new Stack();
    vpc = new Vpc(stack, 'Vpc');
    instance = new Instance(stack, 'Instance', {
      vpc,
      instanceType: new InstanceType('t3.small'),
      machineImage: MachineImage.latestWindows(WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_BASE),
    });
  });

  test('basic setup', () => {
    // WHEN
    new WorkerInstanceConfiguration(stack, 'Config', {
      worker: instance,
    });
    const userData = stack.resolve(instance.userData.render());

    // THEN
    expect(userData).toStrictEqual({
      'Fn::Join': [
        '',
        [
          '<powershell>mkdir (Split-Path -Path \'C:/temp/',
          ...windowsConfigureWorkerScriptBoilerplate(
            `\' \'\' \'\' \'\' \'${Version.MINIMUM_SUPPORTED_DEADLINE_VERSION.toString()}\' ${WorkerInstanceConfiguration['DEFAULT_LISTENER_PORT']} C:/temp/`),
          '\"\' -ErrorAction Stop }</powershell>',
        ],
      ],
    });
  });

  test('groups, pools, region setup', () => {
    // WHEN
    new WorkerInstanceConfiguration(stack, 'Config', {
      worker: instance,
      workerSettings: {
        groups: ['g1', 'g2'],
        pools: ['p1', 'p2'],
        region: 'r1',
      },
    });
    const userData = stack.resolve(instance.userData.render());

    // THEN
    expect(userData).toStrictEqual({
      'Fn::Join': [
        '',
        [
          '<powershell>mkdir (Split-Path -Path \'C:/temp/',
          ...windowsConfigureWorkerScriptBoilerplate(
            `\' \'g1,g2\' \'p1,p2\' \'r1\' \'${Version.MINIMUM_SUPPORTED_DEADLINE_VERSION.toString()}\' ${WorkerInstanceConfiguration['DEFAULT_LISTENER_PORT']} C:/temp/`),
          '\"\' -ErrorAction Stop }</powershell>',
        ],
      ],
    });
  });

  test('custom listner port', () => {
    const otherListenerPort = 55555;
    // WHEN
    new WorkerInstanceConfiguration(stack, 'Config', {
      worker: instance,
      workerSettings: {
        listenerPort: otherListenerPort,
      },
    });
    const userData = stack.resolve(instance.userData.render());

    // THEN
    expect(userData).toStrictEqual({
      'Fn::Join': [
        '',
        [
          '<powershell>mkdir (Split-Path -Path \'C:/temp/',
          ...windowsConfigureWorkerScriptBoilerplate(
            `\' \'\' \'\' \'\' \'${Version.MINIMUM_SUPPORTED_DEADLINE_VERSION.toString()}\' ${otherListenerPort} C:/temp/`),
          '\"\' -ErrorAction Stop }</powershell>',
        ],
      ],
    });
  });

  test('log setup', () => {
    // GIVEN
    const logGroupProps: LogGroupFactoryProps = {
      logGroupPrefix: '/test-prefix/',
    };

    // WHEN
    const config = new WorkerInstanceConfiguration(stack, 'Config', {
      worker: instance,
      cloudWatchLogSettings: logGroupProps,
    });
    const logGroup = config.node.findChild('ConfigLogGroupWrapper');
    const logGroupName = stack.resolve((logGroup as ILogGroup).logGroupName);
    const userData = stack.resolve(instance.userData.render());

    // THEN
    expect(userData).toStrictEqual({
      'Fn::Join': [
        '',
        [
          '<powershell>mkdir (Split-Path -Path \'C:/temp/',
          ...windowsCloudWatchScriptBoilerplate(
            `\' \'\' \'\' \'\' \'${Version.MINIMUM_SUPPORTED_DEADLINE_VERSION.toString()}\' ${WorkerInstanceConfiguration['DEFAULT_LISTENER_PORT']} C:/temp/`),
          '\"\' -ErrorAction Stop }</powershell>',
        ],
      ],
    });

    expectCDK(stack).to(haveResource('AWS::SSM::Parameter', {
      Value: {
        'Fn::Join': [
          '',
          [
            '{\"logs\":{\"logs_collected\":{\"files\":{\"collect_list\":[{\"log_group_name\":\"',
            logGroupName,
            '\",\"log_stream_name\":\"UserdataExecution-{instance_id}\",\"file_path\":\"C:\\\\ProgramData\\\\Amazon\\\\EC2-Windows\\\\Launch\\\\Log\\\\UserdataExecution.log\",\"timezone\":\"Local\"},{\"log_group_name\":\"',
            logGroupName,
            '\",\"log_stream_name\":\"WorkerLogs-{instance_id}\",\"file_path\":\"C:\\\\ProgramData\\\\Thinkbox\\\\Deadline10\\\\logs\\\\deadlineslave*.log\",\"timezone\":\"Local\"},{\"log_group_name\":\"',
            logGroupName,
            '\",\"log_stream_name\":\"LauncherLogs-{instance_id}\",\"file_path\":\"C:\\\\ProgramData\\\\Thinkbox\\\\Deadline10\\\\logs\\\\deadlinelauncher*.log\",\"timezone\":\"Local\"}]}},\"log_stream_name\":\"DefaultLogStream-{instance_id}\",\"force_flush_interval\":15}}',
          ],
        ],
      },
    }));
  });
});

describe('Test WorkerInstanceConfiguration connect to RenderQueue', () => {
  let stack: Stack;
  let vpc: IVpc;
  let renderQueue: RenderQueue;
  let renderQueueSGId: any;

  beforeEach(() => {
    stack = new Stack();
    vpc = new Vpc(stack, 'Vpc');
    const rcsImage = ContainerImage.fromAsset(__dirname);
    const version = new VersionQuery(stack, 'Version');
    renderQueue = new RenderQueue(stack, 'RQ', {
      version,
      vpc,
      images: { remoteConnectionServer: rcsImage },
      repository: new Repository(stack, 'Repository', {
        vpc,
        version,
        secretsManagementSettings: { enabled: false },
      }),
      trafficEncryption: { externalTLS: { enabled: false } },
    });
    const rqSecGrp = renderQueue.connections.securityGroups[0] as SecurityGroup;
    renderQueueSGId = stack.resolve(rqSecGrp.securityGroupId);
  });

  test('For Linux', () => {
    // GIVEN
    const instance = new Instance(stack, 'Instance', {
      vpc,
      instanceType: new InstanceType('t3.small'),
      machineImage: MachineImage.latestAmazonLinux({ generation: AmazonLinuxGeneration.AMAZON_LINUX_2 }),
    });

    // WHEN
    new WorkerInstanceConfiguration(stack, 'Config', {
      worker: instance,
      renderQueue,
    });
    const instanceSG = instance.connections.securityGroups[0] as SecurityGroup;
    const instanceSGId = stack.resolve(instanceSG.securityGroupId);

    // THEN
    // Open-box testing. We know that we invoked the connection method on the
    // render queue if the security group for the instance has an ingress rule to the RQ.
    expectCDK(stack).to(haveResourceLike('AWS::EC2::SecurityGroupIngress', {
      IpProtocol: 'tcp',
      ToPort: 8080,
      SourceSecurityGroupId: instanceSGId,
      GroupId: renderQueueSGId,
    }));
  });

  test('For Windows', () => {
    // GIVEN
    const instance = new Instance(stack, 'Instance', {
      vpc,
      instanceType: new InstanceType('t3.small'),
      machineImage: MachineImage.latestWindows(WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_BASE),
    });

    // WHEN
    new WorkerInstanceConfiguration(stack, 'Config', {
      worker: instance,
      renderQueue,
    });
    const instanceSG = instance.connections.securityGroups[0] as SecurityGroup;
    const instanceSGId = stack.resolve(instanceSG.securityGroupId);

    // THEN
    // Open-box testing. We know that we invoked the connection method on the
    // render queue if the security group for the instance has an ingress rule to the RQ.
    expectCDK(stack).to(haveResourceLike('AWS::EC2::SecurityGroupIngress', {
      IpProtocol: 'tcp',
      ToPort: 8080,
      SourceSecurityGroupId: instanceSGId,
      GroupId: renderQueueSGId,
    }));
  });
});