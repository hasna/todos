import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  PlayIcon,
  CheckCircle2Icon,
  Trash2Icon,
  EyeIcon,
  PencilIcon,
  EllipsisIcon,
  RefreshCwIcon,
  PlusIcon,
} from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TaskView } from "@/types";

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 border-0">
          Completed
        </Badge>
      );
    case "in_progress":
      return (
        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-0">
          In Progress
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-0">
          Pending
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 border-0">
          Failed
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          Cancelled
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function PriorityBadge({ priority }: { priority: string }) {
  switch (priority) {
    case "critical":
      return (
        <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 border-0">
          Critical
        </Badge>
      );
    case "high":
      return (
        <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300 border-0">
          High
        </Badge>
      );
    case "medium":
      return (
        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-0">
          Medium
        </Badge>
      );
    case "low":
      return (
        <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-0">
          Low
        </Badge>
      );
    default:
      return <Badge variant="outline">{priority}</Badge>;
  }
}

const statusLabels: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const priorityLabels: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

interface TasksTableProps {
  data: TaskView[];
  onStart: (task: TaskView) => void;
  onComplete: (task: TaskView) => void;
  onDelete: (task: TaskView) => void;
  onView: (task: TaskView) => void;
  onEdit: (task: TaskView) => void;
  onCreate: () => void;
  onBulkStart: (tasks: TaskView[]) => Promise<void>;
  onBulkComplete: (tasks: TaskView[]) => Promise<void>;
  onBulkDelete: (tasks: TaskView[]) => Promise<void>;
  onReload: () => void;
  loading: boolean;
}

export function TasksTable({
  data,
  onStart,
  onComplete,
  onDelete,
  onView,
  onEdit,
  onCreate,
  onBulkStart,
  onBulkComplete,
  onBulkDelete,
  onReload,
  loading,
}: TasksTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [groupBy, setGroupBy] = React.useState<"project" | "plan" | null>(null);

  const columns: ColumnDef<TaskView>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: "task",
        accessorFn: (row) => row.id,
        header: "Task",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.id.slice(0, 8)}
          </span>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "title",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Title
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => (
          <button
            onClick={() => onView(row.original)}
            className="max-w-[400px] font-medium text-left hover:underline"
          >
            {row.original.title}
          </button>
        ),
      },
      {
        id: "project",
        accessorFn: (row) => row.project_name || "",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Project
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) =>
          row.original.project_name ? (
            <Badge variant="secondary" className="text-xs font-normal">
              {row.original.project_name}
            </Badge>
          ) : (
            <span className="text-muted-foreground">{"\u2014"}</span>
          ),
      },
      {
        id: "plan",
        accessorFn: (row) => row.plan_name || "",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Plan
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) =>
          row.original.plan_name ? (
            <Badge variant="secondary" className="text-xs font-normal bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border-0">
              {row.original.plan_name}
            </Badge>
          ) : (
            <span className="text-muted-foreground">{"\u2014"}</span>
          ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Status
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => <StatusBadge status={row.getValue("status")} />,
        filterFn: "equalsString",
      },
      {
        accessorKey: "priority",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Priority
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => (
          <PriorityBadge priority={row.getValue("priority")} />
        ),
        filterFn: "equalsString",
      },
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Added
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {new Date(row.original.created_at).toLocaleDateString()}
          </span>
        ),
      },
      {
        accessorKey: "updated_at",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Updated
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {new Date(row.original.updated_at).toLocaleDateString()}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const task = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="size-8 p-0">
                  <EllipsisIcon className="size-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onView(task)}>
                  <EyeIcon />
                  View
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(task)}>
                  <PencilIcon />
                  Edit
                </DropdownMenuItem>
                {task.status === "pending" && (
                  <DropdownMenuItem onClick={() => onStart(task)}>
                    <PlayIcon />
                    Start
                  </DropdownMenuItem>
                )}
                {(task.status === "pending" ||
                  task.status === "in_progress") && (
                  <DropdownMenuItem onClick={() => onComplete(task)}>
                    <CheckCircle2Icon />
                    Complete
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(task)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [onStart, onComplete, onDelete, onView, onEdit]
  );

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    enableRowSelection: true,
    initialState: {
      pagination: { pageSize: 20 },
    },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  });

  // Group rows when groupBy is active
  const groupedRows = React.useMemo(() => {
    if (!groupBy) return null;
    const rows = table.getRowModel().rows;
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = groupBy === "project"
        ? row.original.project_name || "No Project"
        : row.original.plan_name || "No Plan";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    return groups;
  }, [groupBy, table.getRowModel().rows]);

  const selectedCount = table.getSelectedRowModel().rows.length;
  const statusFilter = table.getColumn("status")?.getFilterValue() as
    | string
    | undefined;
  const priorityFilter = table.getColumn("priority")?.getFilterValue() as
    | string
    | undefined;

  async function handleBulk(action: (tasks: TaskView[]) => Promise<void>) {
    const tasks = table.getSelectedRowModel().rows.map((r) => r.original);
    await action(tasks);
    setRowSelection({});
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Todos</h2>
        <Button size="sm" onClick={onCreate}>
          <PlusIcon className="size-3.5" />
          New Task
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter tasks..."
          value={
            (table.getColumn("title")?.getFilterValue() as string) ?? ""
          }
          onChange={(e) =>
            table.getColumn("title")?.setFilterValue(e.target.value)
          }
          className="max-w-sm"
        />

        {/* Status filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={
                statusFilter ? "border-primary text-primary" : ""
              }
            >
              {statusFilter
                ? statusLabels[statusFilter] ?? statusFilter
                : "Status"}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={() =>
                table.getColumn("status")?.setFilterValue(undefined)
              }
            >
              All
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {Object.entries(statusLabels).map(([value, label]) => (
              <DropdownMenuItem
                key={value}
                onClick={() =>
                  table.getColumn("status")?.setFilterValue(value)
                }
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Priority filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={
                priorityFilter ? "border-primary text-primary" : ""
              }
            >
              {priorityFilter
                ? priorityLabels[priorityFilter] ?? priorityFilter
                : "Priority"}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={() =>
                table.getColumn("priority")?.setFilterValue(undefined)
              }
            >
              All
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {Object.entries(priorityLabels).map(([value, label]) => (
              <DropdownMenuItem
                key={value}
                onClick={() =>
                  table.getColumn("priority")?.setFilterValue(value)
                }
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Group by */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
            >
              {groupBy ? `Grouped: ${groupBy === "plan" ? "Plan" : "Project"}` : "Group by"}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setGroupBy(null)}>
              None
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setGroupBy("project")}>
              Project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setGroupBy("plan")}>
              Plan
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Reload */}
        <Button
          variant="outline"
          className="ml-auto size-8 p-0"
          onClick={onReload}
          disabled={loading}
          title="Reload tasks"
        >
          <RefreshCwIcon
            className={`size-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              groupedRows ? (
                Array.from(groupedRows.entries()).map(([groupName, rows]) => (
                  <React.Fragment key={groupName}>
                    <TableRow>
                      <TableCell
                        colSpan={columns.length}
                        className="bg-muted/50 py-1.5 text-xs font-medium text-muted-foreground"
                      >
                        {groupName} ({rows.length})
                      </TableCell>
                    </TableRow>
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </React.Fragment>
                ))
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No tasks found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-sm">
          {selectedCount > 0 ? (
            <span>
              {selectedCount} of{" "}
              {table.getFilteredRowModel().rows.length} row(s) selected
            </span>
          ) : (
            <span>
              Page {table.getState().pagination.pageIndex + 1} of{" "}
              {table.getPageCount()} (
              {table.getFilteredRowModel().rows.length} task
              {table.getFilteredRowModel().rows.length !== 1 ? "s" : ""})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Floating bulk action bar */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-lg border bg-background px-4 py-2.5 shadow-lg">
            <span className="text-sm font-medium">
              {selectedCount} selected
            </span>
            <div className="h-4 w-px bg-border" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulk(onBulkStart)}
            >
              <PlayIcon className="size-3.5" />
              Start
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulk(onBulkComplete)}
            >
              <CheckCircle2Icon className="size-3.5" />
              Complete
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleBulk(onBulkDelete)}
            >
              <Trash2Icon className="size-3.5" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
