import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ListTodoIcon, LoaderIcon, CheckCircle2Icon, AlertCircleIcon } from "lucide-react";
import type { TaskView } from "@/types";

interface StatsCardsProps {
  tasks: TaskView[];
}

export function StatsCards({ tasks }: StatsCardsProps) {
  const total = tasks.length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const blocked = tasks.filter((t) => t.status === "failed" || t.status === "cancelled").length;

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ListTodoIcon className="size-4" />
            Total Tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{total}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <LoaderIcon className="size-4" />
            In Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
            {inProgress}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CheckCircle2Icon className="size-4" />
            Completed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">
            {completed}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <AlertCircleIcon className="size-4" />
            Blocked / Failed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
            {blocked}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
