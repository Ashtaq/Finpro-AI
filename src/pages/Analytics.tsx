import { Activity, BrainCircuit, FileText, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorBox, MetricCard, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { formatNumber, monthLabel } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { MonthPoint } from "../types";

interface AnalyticsData {
  activeUsers: number;
  aiRequests: number;
  documents: number;
  conversations: number;
  tasks: number;
  activityEvents: number;
  aiByMonth: MonthPoint[];
  documentsByMonth: MonthPoint[];
}

export default function Analytics() {
  const { data, error, loading, reload } = useAsync(() => api.get<AnalyticsData>("/analytics"));
  const chart = (points: MonthPoint[]) => points.map((p) => ({ month: monthLabel(p.month), value: p.value }));
  return (
    <>
      <PageHeader eyebrow="INSIGHTS" title="Analytics" description="Usage across your organization over the last six months." />
      <ErrorBox message={error} onRetry={reload} />
      {loading && !data ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="metric-grid">
            <MetricCard label="Active users" value={data.activeUsers} icon={<Users size={18} />} />
            <MetricCard
              label="AI requests"
              value={formatNumber(data.aiRequests)}
              icon={<BrainCircuit size={18} />}
              delta={`${data.conversations} conversations`}
            />
            <MetricCard label="Documents" value={formatNumber(data.documents)} icon={<FileText size={18} />} />
            <MetricCard label="Activity events" value={formatNumber(data.activityEvents)} icon={<Activity size={18} />} delta={`${data.tasks} tasks`} />
          </div>
          <div className="grid-2">
            <div className="panel">
              <div className="panel-head">
                <h2>AI requests</h2>
                <p>Questions asked per month</p>
              </div>
              <div className="chart-box tall">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart(data.aiByMonth)}>
                    <CartesianGrid vertical={false} stroke="#edf1f6" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                    <Tooltip />
                    <Line dataKey="value" name="Requests" stroke="#3784ff" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Documents uploaded</h2>
                <p>Files added per month</p>
              </div>
              <div className="chart-box tall">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart(data.documentsByMonth)}>
                    <CartesianGrid vertical={false} stroke="#edf1f6" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                    <Tooltip />
                    <Bar dataKey="value" name="Documents" fill="#16233f" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
