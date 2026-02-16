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
  CheckCircle2Icon,
  ArchiveIcon,
  Trash2Icon,
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
import type { PlanView, ProjectView } from "@/types";

function PlanStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return (
        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-0">
          Active
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 border-0">
          Completed
        </Badge>
      );
    case "archived":
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          Archived
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

const statusLabels: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

interface PlansPageProps {
  plans: PlanView[];
  projects: ProjectView[];
  onDelete: (plan: PlanView) => void;
  onComplete: (plan: PlanView) => void;
  onArchive: (plan: PlanView) => void;
  onEdit: (plan: PlanView) => void;
  onCreate: () => void;
  onBulkDelete: (plans: PlanView[]) => Promise<void>;
  onBulkComplete: (plans: PlanView[]) => Promise<void>;
  onBulkArchive: (plans: PlanView[]) => Promise<void>;
  onReload: () => void;
  loading: boolean;
}

export function PlansPage({
  plans,
  projects,
  onDelete,
  onComplete,
  onArchive,
  onEdit,
  onCreate,
  onBulkDelete,
  onBulkComplete,
  onBulkArchive,
  onReload,
  loading,
}: PlansPageProps) {
  // suppress unused var lint for projects - used for filtering
  void projects;

  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

  const columns: ColumnDef<PlanView>[] = React.useMemo(
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
        accessorKey: "name",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Name
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => (
          <button
            onClick={() => onEdit(row.original)}
            className="font-medium text-left hover:underline"
          >
            {row.original.name}
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
        filterFn: "equalsString",
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
        cell: ({ row }) => <PlanStatusBadge status={row.getValue("status")} />,
        filterFn: "equalsString",
      },
      {
        accessorKey: "task_count",
        header: "Tasks",
        cell: ({ row }) => (
          <Badge variant="secondary">{row.original.task_count ?? 0}</Badge>
        ),
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
            Created
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {new Date(row.original.created_at).toLocaleDateString()}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const plan = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="size-8 p-0">
                  <EllipsisIcon className="size-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(plan)}>
                  <PencilIcon />
                  Edit
                </DropdownMenuItem>
                {plan.status !== "completed" && (
                  <DropdownMenuItem onClick={() => onComplete(plan)}>
                    <CheckCircle2Icon />
                    Complete
                  </DropdownMenuItem>
                )}
                {plan.status !== "archived" && (
                  <DropdownMenuItem onClick={() => onArchive(plan)}>
                    <ArchiveIcon />
                    Archive
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(plan)}
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
    [onComplete, onArchive, onDelete, onEdit]
  );

  const table = useReactTable({
    data: plans,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: true,
    initialState: {
      pagination: { pageSize: 20 },
    },
    state: {
      sorting,
      columnFilters,
      rowSelection,
    },
  });

  const selectedCount = table.getSelectedRowModel().rows.length;
  const statusFilter = table.getColumn("status")?.getFilterValue() as string | undefined;
  const projectFilter = table.getColumn("project")?.getFilterValue() as string | undefined;

  async function handleBulk(action: (plans: PlanView[]) => Promise<void>) {
    const selected = table.getSelectedRowModel().rows.map((r) => r.original);
    await action(selected);
    setRowSelection({});
  }

  // Get unique project names for filter
  const projectNames = React.useMemo(() => {
    const names = new Set<string>();
    for (const p of plans) {
      if (p.project_name) names.add(p.project_name);
    }
    return Array.from(names).sort();
  }, [plans]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Plans</h2>
        <Button size="sm" onClick={onCreate}>
          <PlusIcon className="size-3.5" />
          New Plan
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter plans..."
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("name")?.setFilterValue(e.target.value)
          }
          className="max-w-sm"
        />

        {/* Status filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={statusFilter ? "border-primary text-primary" : ""}
            >
              {statusFilter ? statusLabels[statusFilter] ?? statusFilter : "Status"}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={() => table.getColumn("status")?.setFilterValue(undefined)}
            >
              All
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {Object.entries(statusLabels).map(([value, label]) => (
              <DropdownMenuItem
                key={value}
                onClick={() => table.getColumn("status")?.setFilterValue(value)}
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Project filter */}
        {projectNames.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={projectFilter ? "border-primary text-primary" : ""}
              >
                {projectFilter || "Project"}
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => table.getColumn("project")?.setFilterValue(undefined)}
              >
                All
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {projectNames.map((name) => (
                <DropdownMenuItem
                  key={name}
                  onClick={() => table.getColumn("project")?.setFilterValue(name)}
                >
                  {name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Reload */}
        <Button
          variant="outline"
          className="ml-auto size-8 p-0"
          onClick={onReload}
          disabled={loading}
          title="Reload plans"
        >
          <RefreshCwIcon className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
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
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No plans found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-sm">
          {selectedCount > 0 ? (
            <span>
              {selectedCount} of {table.getFilteredRowModel().rows.length} row(s) selected
            </span>
          ) : (
            <span>
              {table.getFilteredRowModel().rows.length} plan{table.getFilteredRowModel().rows.length !== 1 ? "s" : ""}
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
            <span className="text-sm font-medium">{selectedCount} selected</span>
            <div className="h-4 w-px bg-border" />
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
              variant="outline"
              onClick={() => handleBulk(onBulkArchive)}
            >
              <ArchiveIcon className="size-3.5" />
              Archive
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
