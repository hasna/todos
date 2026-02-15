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
} from "@tanstack/react-table";
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  PlayIcon,
  CheckCircle2Icon,
  Trash2Icon,
  EyeIcon,
} from "lucide-react";

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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TaskView } from "@/types";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const abs = Math.abs(diff);
  if (abs < 60000) return Math.round(abs / 1000) + "s ago";
  if (abs < 3600000) return Math.round(abs / 60000) + "m ago";
  if (abs < 86400000) return Math.round(abs / 3600000) + "h ago";
  return Math.round(abs / 86400000) + "d ago";
}

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

interface TasksTableProps {
  data: TaskView[];
  onStart: (task: TaskView) => void;
  onComplete: (task: TaskView) => void;
  onDelete: (task: TaskView) => void;
  onView: (task: TaskView) => void;
}

export function TasksTable({
  data,
  onStart,
  onComplete,
  onDelete,
  onView,
}: TasksTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState({});

  const columns: ColumnDef<TaskView>[] = React.useMemo(
    () => [
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
          <div className="max-w-[300px]">
            <div className="font-medium">{row.original.title}</div>
            {row.original.description && (
              <div className="text-xs text-muted-foreground truncate">
                {row.original.description}
              </div>
            )}
          </div>
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
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.project_name || "\u2014"}
          </span>
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
      },
      {
        accessorKey: "assigned_to",
        header: "Assigned To",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.assigned_to || "\u2014"}
          </span>
        ),
      },
      {
        id: "tags",
        accessorFn: (row) => row.tags.join(", "),
        header: "Tags",
        cell: ({ row }) => {
          const tags = row.original.tags;
          if (tags.length === 0) return <span className="text-muted-foreground">{"\u2014"}</span>;
          return (
            <div className="flex gap-1 flex-wrap">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        id: "created",
        accessorFn: (row) => new Date(row.created_at).getTime(),
        header: "Created",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {timeAgo(row.original.created_at)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const task = row.original;
          return (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onView(task)}
              >
                <EyeIcon className="size-3.5" />
              </Button>
              {task.status === "pending" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onStart(task)}
                >
                  <PlayIcon className="size-3.5" />
                  Start
                </Button>
              )}
              {(task.status === "pending" || task.status === "in_progress") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onComplete(task)}
                >
                  <CheckCircle2Icon className="size-3.5" />
                  Done
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(task)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          );
        },
      },
    ],
    [onStart, onComplete, onDelete, onView]
  );

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    initialState: {
      pagination: { pageSize: 10 },
    },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
  });

  return (
    <div className="space-y-4">
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="ml-auto">
              Columns <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) =>
                    column.toggleVisibility(!!value)
                  }
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
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
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-sm">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {table.getPageCount()} ({table.getFilteredRowModel().rows.length}{" "}
          task{table.getFilteredRowModel().rows.length !== 1 ? "s" : ""})
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
    </div>
  );
}
