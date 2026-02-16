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
  Trash2Icon,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectView } from "@/types";

interface ProjectsPageProps {
  projects: ProjectView[];
  onDelete: (project: ProjectView) => void;
  onCreate: () => void;
  onBulkDelete: (projects: ProjectView[]) => Promise<void>;
  onReload: () => void;
  onView: (project: ProjectView) => void;
  loading: boolean;
}

export function ProjectsPage({
  projects,
  onDelete,
  onCreate,
  onBulkDelete,
  onReload,
  onView,
  loading,
}: ProjectsPageProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

  const columns: ColumnDef<ProjectView>[] = React.useMemo(
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
            onClick={() => onView(row.original)}
            className="font-medium text-left hover:underline"
          >
            {row.original.name}
          </button>
        ),
      },
      {
        accessorKey: "path",
        header: "Path",
        cell: ({ row }) => (
          <code className="text-xs text-muted-foreground">
            {row.original.path || "\u2014"}
          </code>
        ),
      },
      {
        accessorKey: "task_list_id",
        header: "Task List ID",
        cell: ({ row }) =>
          row.original.task_list_id ? (
            <code className="text-xs text-muted-foreground">
              {row.original.task_list_id.slice(0, 8)}
            </code>
          ) : (
            <span className="text-muted-foreground">{"\u2014"}</span>
          ),
      },
      {
        accessorKey: "task_count",
        header: () => <span className="text-center w-full block">Tasks</span>,
        cell: ({ row }) => (
          <div className="text-center">
            <Badge variant="secondary">{row.original.task_count ?? 0}</Badge>
          </div>
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
          const project = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="size-8 p-0">
                  <EllipsisIcon className="size-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => onDelete(project)}
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
    [onDelete, onView]
  );

  const table = useReactTable({
    data: projects,
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

  async function handleBulk(action: (projects: ProjectView[]) => Promise<void>) {
    const selected = table.getSelectedRowModel().rows.map((r) => r.original);
    await action(selected);
    setRowSelection({});
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Projects</h2>
        <Button size="sm" onClick={onCreate}>
          <PlusIcon className="size-3.5" />
          New Project
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter projects..."
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("name")?.setFilterValue(e.target.value)
          }
          className="max-w-sm"
        />

        <Button
          variant="outline"
          className="ml-auto size-8 p-0"
          onClick={onReload}
          disabled={loading}
          title="Reload projects"
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
                  No projects found.
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
              {table.getFilteredRowModel().rows.length} project{table.getFilteredRowModel().rows.length !== 1 ? "s" : ""}
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
