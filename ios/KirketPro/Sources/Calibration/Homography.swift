import CoreGraphics
import Foundation
import simd

enum HomographyError: Error {
    case invalidPointCount
    case degenerateGeometry
}

enum Homography {
    static func solve(source: [CGPoint], destination: [CGPoint]) throws -> simd_double3x3 {
        guard source.count == 4, destination.count == 4 else {
            throw HomographyError.invalidPointCount
        }

        var matrix = Array(repeating: Array(repeating: 0.0, count: 9), count: 8)
        for index in 0..<4 {
            let x = Double(source[index].x)
            let y = Double(source[index].y)
            let u = Double(destination[index].x)
            let v = Double(destination[index].y)
            matrix[index * 2] = [x, y, 1, 0, 0, 0, -u * x, -u * y, u]
            matrix[index * 2 + 1] = [0, 0, 0, x, y, 1, -v * x, -v * y, v]
        }

        for column in 0..<8 {
            var pivot = column
            for row in (column + 1)..<8 where abs(matrix[row][column]) > abs(matrix[pivot][column]) {
                pivot = row
            }
            matrix.swapAt(column, pivot)
            let pivotValue = matrix[column][column]
            guard abs(pivotValue) > 1e-12 else { throw HomographyError.degenerateGeometry }
            for item in column..<9 { matrix[column][item] /= pivotValue }
            for row in 0..<8 where row != column {
                let factor = matrix[row][column]
                for item in column..<9 {
                    matrix[row][item] -= factor * matrix[column][item]
                }
            }
        }

        let h = matrix.map { $0[8] } + [1]
        // simd matrices are column-major.
        return simd_double3x3(
            SIMD3(h[0], h[3], h[6]),
            SIMD3(h[1], h[4], h[7]),
            SIMD3(h[2], h[5], h[8])
        )
    }

    static func project(_ point: CGPoint, using matrix: simd_double3x3) -> CGPoint {
        let result = matrix * SIMD3(Double(point.x), Double(point.y), 1)
        return CGPoint(x: result.x / result.z, y: result.y / result.z)
    }

    static func inverse(_ matrix: simd_double3x3) throws -> simd_double3x3 {
        let determinant = simd_determinant(matrix)
        guard abs(determinant) > 1e-12 else { throw HomographyError.degenerateGeometry }
        return matrix.inverse
    }

    static func reprojectionError(
        source: [CGPoint],
        destination: [CGPoint],
        matrix: simd_double3x3
    ) -> Double {
        zip(source, destination)
            .map { pair in
                let projected = project(pair.0, using: matrix)
                return hypot(Double(projected.x - pair.1.x), Double(projected.y - pair.1.y))
            }
            .reduce(0, +) / Double(max(source.count, 1))
    }
}
