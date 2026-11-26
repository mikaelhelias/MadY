# ggplot2 reference: geom_violin — scale, trim, adjust, quantiles, fill by group
p <- ggplot(mtcars, aes(factor(cyl), mpg))
p + geom_violin(aes(fill = factor(cyl)), scale = "width", trim = FALSE, adjust = .5,
                draw_quantiles = c(0.25, 0.5, 0.75))
