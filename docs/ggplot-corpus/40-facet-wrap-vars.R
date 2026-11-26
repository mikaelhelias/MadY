# ggplot2 reference: facet_wrap(vars(...)), nrow
p <- ggplot(mpg, aes(displ, hwy)) + geom_point()
p + facet_wrap(vars(class), nrow = 4)
