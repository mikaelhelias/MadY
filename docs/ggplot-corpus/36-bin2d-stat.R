# ggplot2 reference: stat_bin_2d
cars <- ggplot(mtcars, aes(mpg, factor(cyl)))
cars + stat_bin_2d(aes(fill = after_stat(count)), binwidth = c(3,1))
