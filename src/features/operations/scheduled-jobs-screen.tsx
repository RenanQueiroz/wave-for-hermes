import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { Alert, Badge, Card, Spinner, Typography } from 'panelui-native';
import { ScrollView, View } from 'react-native';

import { ScreenHeader } from '@/components/navigation/screen-header';
import { useWaveConnection } from '@/features/connection/connection-provider';
import { useReturnToActiveConversation } from '@/features/navigation/use-return-to-active-conversation';

export function ScheduledJobsScreen() {
  const connection = useWaveConnection();
  if (connection.state.phase !== 'connected' || !connection.client) {
    return <Redirect href="/" />;
  }
  return (
    <ConnectedScheduledJobsScreen
      baseUrl={connection.state.summary.baseUrl}
      client={connection.client}
      connectionId={connection.state.summary.device.id}
    />
  );
}

function ConnectedScheduledJobsScreen({
  baseUrl,
  client,
  connectionId,
}: {
  baseUrl: string;
  client: NonNullable<ReturnType<typeof useWaveConnection>['client']>;
  connectionId: string;
}) {
  const returnToActiveConversation =
    useReturnToActiveConversation(connectionId);
  const jobs = useQuery({
    queryFn: ({ signal }) => client.listScheduledJobs(signal),
    queryKey: ['wave', connectionId, baseUrl, 'operations', 'jobs'],
  });

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title="Scheduled jobs"
        onBack={returnToActiveConversation}
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3 px-4 py-4">
        <View className="gap-1 pb-2">
          <Typography.Heading type="h2">Hermes schedules</Typography.Heading>
          <Typography.Paragraph muted>
            Read-only status from your Hermes agent. Job controls remain in
            Hermes.
          </Typography.Paragraph>
        </View>

        {jobs.isPending ? (
          <View className="items-center py-12">
            <Spinner />
          </View>
        ) : jobs.error ? (
          <Alert variant="destructive" testID="scheduled-jobs-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Schedules unavailable</Alert.Title>
              <Alert.Description>
                This Hermes server may not expose scheduled jobs.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : jobs.data.jobs.length === 0 ? (
          <Typography.Paragraph muted className="py-10 text-center">
            No scheduled jobs.
          </Typography.Paragraph>
        ) : (
          jobs.data.jobs.map((job) => (
            <Card key={job.id} testID={`scheduled-job-${job.id}`}>
              <Card.Header className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-1">
                  <Card.Title>{job.name}</Card.Title>
                  <Card.Description>{job.schedule}</Card.Description>
                </View>
                <Badge variant={job.enabled ? 'default' : 'secondary'}>
                  {job.enabled ? job.state : 'Disabled'}
                </Badge>
              </Card.Header>
              <Card.Content className="gap-1">
                {job.nextRunAt ? (
                  <JobTime label="Next" value={job.nextRunAt} />
                ) : null}
                {job.lastRunAt ? (
                  <JobTime label="Last" value={job.lastRunAt} />
                ) : null}
                {job.lastStatus ? (
                  <Typography.Paragraph muted>
                    Last status: {job.lastStatus}
                  </Typography.Paragraph>
                ) : null}
              </Card.Content>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function JobTime({ label, value }: { label: string; value: string }) {
  const date = new Date(value);
  return (
    <Typography.Paragraph muted>
      {label}: {Number.isNaN(date.getTime()) ? value : date.toLocaleString()}
    </Typography.Paragraph>
  );
}
